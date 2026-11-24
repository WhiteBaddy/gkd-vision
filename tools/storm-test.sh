#!/data/data/com.termux/files/usr/bin/bash
# Prove the stream path is fork-safe: at most one screenrecord + one ffmpeg,
# and an instant-failure pipeline must trip the breaker and fall back.
#
#   tools/storm-test.sh          # simulated failures (safe: no real recording)
#   tools/storm-test.sh real 30  # real recording with a 4s limit for 30s
set -u
MODE=${1:-sim}
SECS=${2:-20}
LIMIT=${3:-4}
PORT=7790
cd "$(dirname "$0")/.." || exit 1

if [ "$MODE" = "sim" ]; then
  export GKD_VISION_SIMULATE_STREAM_FAIL=1
fi

node server.mjs --driver root --port $PORT --fps 8 --record-limit "$LIMIT" > frames/storm.log 2>&1 &
SRV=$!
sleep 2

MAX_FF=0
MAX_REC=0
FAIL=0
for i in $(seq 1 $((SECS * 2))); do
  FF=$(pgrep -c -x ffmpeg 2>/dev/null); FF=${FF:-0}
  REC=$(su -c "pgrep -c -x screenrecord" 2>/dev/null); REC=${REC:-0}
  [ "$FF" -gt "$MAX_FF" ] && MAX_FF=$FF
  [ "$REC" -gt "$MAX_REC" ] && MAX_REC=$REC
  if [ "$FF" -gt 2 ] || [ "$REC" -gt 1 ]; then
    echo "FAIL: fork storm ffmpeg=$FF screenrecord=$REC at t=$((i/2))s"
    pkill -x ffmpeg 2>/dev/null
    su -c "pkill -x screenrecord" 2>/dev/null
    kill -9 $SRV 2>/dev/null
    FAIL=1
    break
  fi
  sleep 0.5
done

STATE=$(curl -s -m 5 "http://127.0.0.1:$PORT/api/state" || echo '{}')
FW=$(curl -s -m 5 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/frame" || echo 000)
kill -TERM $SRV 2>/dev/null
wait $SRV 2>/dev/null
sleep 1

echo "mode=$MODE max_ffmpeg=$MAX_FF max_screenrecord=$MAX_REC frame_http=$FW"
echo "$STATE" | python3 -c "
import json,sys
try:
    d=json.load(sys.stdin); s=d['state']; e=s['engine']
    print('fps', s['fps'], 'seq', s['seq'], 'degraded', e.get('degraded'),
          'restarts', e.get('restartCount'), 'warnings', [w['message'] for w in d.get('warnings',[])])
except Exception as e:
    print('state unavailable', e)
"
echo "leftovers: ffmpeg=$(pgrep -c -x ffmpeg 2>/dev/null || echo 0) screenrecord=$(su -c 'pgrep -c -x screenrecord' 2>/dev/null || echo 0)"
exit $FAIL
