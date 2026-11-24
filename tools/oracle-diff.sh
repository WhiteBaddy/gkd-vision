#!/data/data/com.termux/files/usr/bin/bash
# 同一屏幕下对比「自研驱动」与「GKD」的快照质量。
# 需要两者同时可访问：自研 8899，GKD 8888（GKD 需在应用内开启 HTTP 调试服务）。
set -u
OURS=${OURS:-http://127.0.0.1:8899}
GKD=${GKD:-http://127.0.0.1:8888}
TMP=$(mktemp -d)

if ! curl -s -m 3 -XPOST "$GKD/api/getServerInfo" -o "$TMP/gkd.info" 2>/dev/null; then
  echo "SKIP: GKD 不可达（$GKD），先在其应用内开启 HTTP 调试服务" >&2
  exit 2
fi

curl -s -m 15 -XPOST "$OURS/api/captureSnapshot" -o "$TMP/ours.json" || { echo "FAIL: 自研驱动不可达 $OURS" >&2; exit 1; }
curl -s -m 15 -XPOST "$GKD/api/captureSnapshot" -o "$TMP/gkd.json" || { echo "FAIL: GKD 抓帧失败" >&2; exit 1; }

python3 - "$TMP/ours.json" "$TMP/gkd.json" <<'PY'
import json, sys
ours = json.load(open(sys.argv[1]))
gkd = json.load(open(sys.argv[2]))

def texts(doc):
    out = set()
    for n in doc.get("nodes", []):
        t = (n.get("attr") or {}).get("text")
        if t and str(t).strip():
            out.add(str(t).strip())
    return out

to, tg = texts(ours), texts(gkd)
recall = (len(to & tg) / len(tg) * 100) if tg else 100.0
print(f"nodes: ours={len(ours.get('nodes', []))} gkd={len(gkd.get('nodes', []))}")
print(f"texts: ours={len(to)} gkd={len(tg)} recall={recall:.1f}%")
print(f"appId: ours={ours.get('appId')} gkd={gkd.get('appId')}")
print(f"screen: ours={ours.get('screenWidth')}x{ours.get('screenHeight')} gkd={gkd.get('screenWidth')}x{gkd.get('screenHeight')}")
missing = sorted(tg - to)[:8]
if missing:
    print("missing sample:", missing)
ok = recall >= 95
print("RESULT:", "PASS" if ok else "FAIL (recall < 95%)")
sys.exit(0 if ok else 1)
PY
