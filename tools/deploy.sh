#!/data/data/com.termux/files/usr/bin/bash
# 一键部署 Vision Driver：安装、启用无障碍、电池白名单、健康检查（幂等）。
#   tools/deploy.sh [apk路径]
set -euo pipefail

PKG=dev.everything.vision
SERVICE="$PKG/$PKG.A11yService"
PORT=${PORT:-8899}
APK=${1:-}

if [ -z "$APK" ]; then
  APK=$(mktemp)
  curl -sL -o "$APK" https://github.com/WhiteBaddy/gkd-vision/releases/download/ci-latest/driver-app-debug.apk
fi

su -c "pm install -r '$APK'"
# 重新绑定服务，确保加载的是新安装的代码
su -c "settings put secure enabled_accessibility_services ''"
sleep 1
su -c "settings put secure enabled_accessibility_services $SERVICE"
su -c "settings put secure accessibility_enabled 1"
su -c "dumpsys deviceidle whitelist +$PKG" >/dev/null 2>&1 || true

for _ in $(seq 1 20); do
  if curl -s -m 2 -XPOST "http://127.0.0.1:$PORT/api/state" | grep -q '"status":"ok"'; then
    echo "OK: $PKG ready on 127.0.0.1:$PORT"
    exit 0
  fi
  sleep 1
done

echo "FAIL: 服务未就绪，检查无障碍授权或端口占用" >&2
exit 1
