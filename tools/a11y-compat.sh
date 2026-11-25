#!/data/data/com.termux/files/usr/bin/bash
# 微信等应用的控件树"门控"兼容开关。
# 用法: tools/a11y-compat.sh on|off|status
#   on     在自研服务之外，额外启用 Select to Speak（静默、按需朗读）
#   off    只保留自研服务
#   status 打印当前服务与微信可见节点数（需要服务在 7788 运行）
set -u
OURS="dev.everything.vision/dev.everything.vision.A11yService"
COMPAT="com.google.android.marvin.talkback/com.google.android.accessibility.selecttospeak.SelectToSpeakService"
BASE=${BASE:-http://127.0.0.1:7788}

current() { su -c "settings get secure enabled_accessibility_services" 2>/dev/null | tr -d '\r' | tr ':' '\n' | grep -v '^$' | grep -v '^null$'; }

apply() {
  local list="$1"
  su -c "settings put secure enabled_accessibility_services '$list'"
  su -c "settings put secure accessibility_enabled 1"
  # 强制重绑：先清空再写回
  su -c "settings put secure enabled_accessibility_services ''"
  sleep 1
  su -c "settings put secure enabled_accessibility_services '$list'"
  sleep 3
}

nodes() {
  curl -s -m 12 -XPOST "$BASE/api/fingerprint" -d '{"fresh":true}' 2>/dev/null \
    | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('nodeCount','?'))" 2>/dev/null || echo "?"
}

case "${1:-status}" in
  on)
    list=$(current | grep -v "$OURS" | grep -v "$COMPAT")
    list=$(printf '%s\n%s\n%s\n' "$OURS" "$COMPAT" "$list" | grep -v '^$' | paste -sd:)
    apply "$list"
    echo "compat=on  服务: $list"
    echo "微信可见节点数: $(nodes)"
    ;;
  off)
    list=$(current | grep -v "$OURS" | grep -v "$COMPAT")
    list=$(printf '%s\n%s\n' "$OURS" "$list" | grep -v '^$' | paste -sd:)
    apply "$list"
    echo "compat=off 服务: $list"
    echo "微信可见节点数: $(nodes)"
    ;;
  status)
    echo "当前服务: $(current | paste -sd:)"
    if current | grep -q "$COMPAT"; then echo "compat=on"; else echo "compat=off"; fi
    echo "可见节点数: $(nodes)"
    ;;
  *)
    echo "用法: $0 on|off|status"; exit 2;;
esac
