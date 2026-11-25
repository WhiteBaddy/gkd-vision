#!/data/data/com.termux/files/usr/bin/bash
# 输出驱动令牌（Termux 通过 root 读取应用私有文件）。
#   tools/token.sh          # 打印
#   eval "$(tools/token.sh --export)"   # 导出 VISION_TOKEN
set -u
PKG=dev.everything.vision
T=$(su -c "cat /data/data/$PKG/files/vision.token 2>/dev/null" | tr -d '\r\n')
if [ -z "$T" ]; then
  echo "token 未生成：确认无障碍服务已启用并至少启动过一次" >&2
  exit 1
fi
if [ "${1:-}" = "--export" ]; then
  printf 'export VISION_TOKEN=%s\n' "$T"
else
  printf '%s\n' "$T"
fi
