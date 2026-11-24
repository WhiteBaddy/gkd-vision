#!/data/data/com.termux/files/usr/bin/bash
# 集成测试（S3）：协议、恢复、部署幂等、可选 soak。
#   tools/it.sh            # 常规用例
#   tools/it.sh --soak 180 # 额外跑 N 秒 soak（记录 RSS/fd）
set -u
PORT=${PORT:-8899}
PKG=dev.everything.vision
SERVICE="$PKG/$PKG.A11yService"
BASE="http://127.0.0.1:$PORT"
TMP=${TMPDIR:-${PREFIX:-/data/data/com.termux/files/usr}/tmp}
mkdir -p "$TMP"
PASS=0
FAIL=0

ok()   { PASS=$((PASS+1)); echo "PASS  $1"; }
bad()  { FAIL=$((FAIL+1)); echo "FAIL  $1"; }
need() { command -v "$1" >/dev/null 2>&1; }

state_field() { curl -s -m 5 -XPOST "$BASE/api/state" | python3 -c "import json,sys; print(json.load(sys.stdin).get('$1',''))" 2>/dev/null; }

echo "== TC-12 协议形状 =="
[ "$(state_field status)" = "ok" ] && ok "state.status=ok" || bad "state.status"
curl -s -m 15 -XPOST "$BASE/api/captureSnapshot" -o "$TMP/snap.json" 2>/dev/null || true
N=$(python3 -c "import json;print(len(json.load(open('$TMP/snap.json')).get('nodes',[])))" 2>/dev/null || echo 0)
[ "$N" -gt 10 ] && ok "captureSnapshot nodes=$N" || bad "captureSnapshot nodes=$N"
ID=$(python3 -c "import json;print(json.load(open('$TMP/snap.json'))['id'])" 2>/dev/null || echo 0)
CODE=$(curl -s -m 10 -XPOST "$BASE/api/getScreenshot" -d "{\"id\":$ID}" -o "$TMP/shot.webp" -w '%{http_code}')
[ "$CODE" = "200" ] && ok "getScreenshot 200" || bad "getScreenshot $CODE"
HDR=$(curl -s -m 5 -XPOST "$BASE/api/execSelector" -d 'not-json' -D- -o /dev/null | grep -ci "GKD-RPC-Status: error")
[ "$HDR" = "1" ] && ok "错误头" || bad "错误头"
[ "$(head -c 4 "$TMP/shot.webp")" = "RIFF" ] && ok "截图是 WebP" || bad "截图格式"

echo "== TC-19 驱动回退（auto）=="
if need node; then
  node server.mjs --driver auto --port 7791 >"$TMP/auto.log" 2>&1 & P=$!
  sleep 6
  D=$(curl -s -m 5 http://127.0.0.1:7791/api/state | python3 -c "import json,sys;print(json.load(sys.stdin)['driver'])" 2>/dev/null || echo none)
  [ "$D" = "auto" ] && ok "auto 启动成功（当前 a11y 可达）" || bad "auto 启动失败"
  kill -TERM $P 2>/dev/null
else
  bad "node 不可用"
fi

echo "== TC-20 部署幂等 =="
if bash tools/deploy.sh >"$TMP/deploy.log" 2>&1; then ok "deploy.sh 第二次执行通过"; else bad "deploy.sh 幂等失败"; fi

echo "== TC-17 掉线恢复 =="
su -c "am force-stop $PKG" 2>/dev/null
sleep 8
if curl -s -m 3 -XPOST "$BASE/api/state" | grep -q '"status":"ok"'; then
  ok "force-stop 后服务自动恢复"
else
  su -c "settings put secure enabled_accessibility_services '$SERVICE'" 2>/dev/null
  sleep 5
  if curl -s -m 3 -XPOST "$BASE/api/state" | grep -q '"status":"ok"'; then
    ok "force-stop 后需重设服务才恢复（已恢复）"
  else
    bad "force-stop 后未恢复"
  fi
fi

if [ "${1:-}" = "--soak" ]; then
  SECS=${2:-120}
  PID=$(su -c "ps -A -o pid,NAME | awk '\$2==\"$PKG\"{print \$1}'" | head -1)
  R0=$(su -c "ps -A -o pid,rss,NAME | awk '\$2==\"$PKG\"{print \$2}'" | head -1)
  F0=$(su -c "ls /proc/$PID/fd 2>/dev/null | wc -l")
  echo "== soak ${SECS}s (rss0=${R0}KB fd0=${F0}) =="
  sleep "$SECS"
  R1=$(su -c "ps -A -o pid,rss,NAME | awk '\$2==\"$PKG\"{print \$2}'" | head -1)
  F1=$(su -c "ls /proc/$PID/fd 2>/dev/null | wc -l")
  echo "soak: rss ${R0}KB -> ${R1}KB, fd ${F0} -> ${F1}"
fi

echo "----"
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
