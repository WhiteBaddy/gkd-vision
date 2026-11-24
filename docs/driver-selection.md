# 驱动选型分析：自研无障碍 App / app_process / GKD

> 目标：**尽量减少目标用户使用时的配置步骤**，所以产线不复用 GKD 应用；GKD 只在开发与测试阶段当基准。
> 本文只回答"选哪条驱动、为什么、代价多少"，不重复 `approach.md` 里的协议与性能背景。

## 0. 结论摘要

| 结论 | 说明 |
| --- | --- |
| 产线选 **A（自研无障碍 App）** | 唯一同时覆盖 root / 非 root 设备、且能长期稳定运行的方案 |
| **B（app_process + UiAutomation）技术成立但只适合 root 设备** | 好处是零安装，代价是进程保活、隐藏 API、跨版本稳定性和维护成本 |
| 让 A 的配置接近零 | root 设备用脚本完成"安装 + 启用 + 白名单"；非 root 设备保留"装 → 开无障碍"两步，这是系统安全边界，绕不过 |
| 配置最少的一种形态 | 把 `A11yService` 作为组件**并进目标 App 本身**，用户不需要额外装任何东西 |
| GKD 的定位 | 开发期 oracle + 联调基准 + 回退驱动，不参与产线 |

## 1. 三个必须先说清的事实

### 1.1 `uiautomator dump` 失败的原因不是权限

AOSP [`DumpCommand.java`](https://raw.githubusercontent.com/aosp-mirror/platform_frameworks_base/master/cmds/uiautomator/cmds/uiautomator/src/com/android/commands/uiautomator/DumpCommand.java)：

```java
automationWrapper.connect();                        // ← 连接成功
UiAutomation uiAutomation = automationWrapper.getUiAutomation();
uiAutomation.waitForIdle(1000, 1000 * 10);          // ← 强制等界面静止，10s 超时
...
} catch (TimeoutException re) {
    System.err.println("ERROR: could not get idle state.");
}
```

本机实测（root，连续 3 次，含 `--compressed`）全部停在这一步：

```
ERROR: could not get idle state.
```

界面只要有持续动画（浏览器、视频、光标、进度条）就永远不会 idle。同类现象见 [mobilewright#117](https://github.com/mobile-next/mobilewright/issues/117)。
**结论：跳过 `waitForIdle` 的自定义工具可以正常取树。**

### 1.2 root 能拿到 `UiAutomation`

AOSP [`UiAutomationConnection.java`](https://raw.githubusercontent.com/aosp-mirror/platform_frameworks_base/master/core/java/android/app/UiAutomationConnection.java)：

```java
private void throwIfCalledByNotTrustedUidLocked() {
    final int callingUid = Binder.getCallingUid();
    if (callingUid != mOwningUid && mOwningUid != Process.SYSTEM_UID
            && callingUid != 0 /*root*/) {
        throw new SecurityException("Calling from not trusted UID!");
    }
}
```

root 被显式信任。旁证：`/system/bin/uiautomator` 脚本自带 `USER_ID=0` 分支；本机 root 下 `connect()` 成功（否则不会走到 `waitForIdle`）。
**结论：B 方案在原厂 root 环境下可行。**

### 1.3 root 本身不产生控件树

控件树（`AccessibilityNodeInfo`）由无障碍框架实时组装，必须有一个 `AccessibilityService` 在跑。
root 能做的是：读像素、注入触摸、改系统设置、给 App 授权 / 启用无障碍。**没有 a11y 服务，就没有树。**

本机两条"零安装取树"路径实测：

| 方式 | 结果 |
| --- | --- |
| `uiautomator dump`（root） | ❌ `could not get idle state`（3/3） |
| `dumpsys activity top`（root） | ⚠️ 可用但很弱：10s / 145KB / 1493 行 / **0 处 text** / 按 task 列 / 部分 activity `Timeout` |

`dumpsys activity top` 给的是 **View 树**（class + resource id + 边界），不是无障碍树：没有 text、desc、clickable，Compose/WebView/SurfaceView 只有一个壳。能看布局，不能做文本定位。

## 2. 方案 A：自研无障碍 App

### 2.1 能力面（全部公开 SDK，API 30+）

| 需求 | 实现 | 备注 |
| --- | --- | --- |
| 控件树 | `getRootInActiveWindow()` 遍历 `AccessibilityNodeInfo` | text/desc/vid/class/bounds/clickable/editable/scrollable |
| 截图 | `takeScreenshot()` → `HardwareBuffer` → Bitmap → WebP | **不需要 ffmpeg / screenrecord** |
| 点击 / 长按 | `dispatchGesture()` 或 `performAction(ACTION_CLICK)` | 与 GKD 同源 |
| 滑动 | `dispatchGesture(StrokeDescription)` | 可控制时长 |
| 文本输入 | `ACTION_SET_TEXT` | 支持中文，优于 `input text` |
| 返回 / 桌面 / 多任务 | `performGlobalAction()` | 无需 root |
| 对外接口 | 进程内 `ServerSocket` / NanoHTTPD，只监听 127.0.0.1 | 可复用 GKD 的 `/api/*` 形状 |

### 2.2 配置难度

| 场景 | 步骤 | 说明 |
| --- | --- | --- |
| 非 root 用户 | 装 APK → 设置里开无障碍 | 2 步；这是 Android 的安全边界，无法静默开启 |
| root 设备 | 一段脚本：`pm install` + `settings put secure enabled_accessibility_services` + `accessibility_enabled 1` + 电池白名单 | **0 步人工** |
| 最优形态 | 把 `A11yService` 并进目标 App | 用户装目标 App 即完成，只差一次无障碍开关 |

root 一键启用示例：

```bash
su -c "pm install -r /data/local/tmp/driver.apk"
su -c "settings put secure enabled_accessibility_services com.example.driver/com.example.driver.A11yService"
su -c "settings put secure accessibility_enabled 1"
su -c "dumpsys deviceidle whitelist +com.example.driver"
```

### 2.3 风险

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| ROM 杀无障碍服务（MIUI/HyperOS 常见） | 服务掉线 | 常驻通知 + 电池白名单 + `onServiceConnected` 自检 + 掉线告警 |
| 重启后需重新确认（部分 ROM） | 用户侧多一步 | root 脚本写回 `enabled_accessibility_services`；或 `BOOT_COMPLETED` 自检 |
| WebView / Compose 树质量 | 文本缺失 | 与 GKD 同源，无差别；必要时补截图 + OCR |
| 后台被限制 | HTTP 端口不可达 | 前台服务 + `START_STICKY` |

### 2.4 工作量（估）

| 模块 | 估时 |
| --- | --- |
| 服务骨架 + 快照 JSON | 2 天 |
| 手势 + `SET_TEXT` + 选择器lite | 1.5 天 |
| HTTP/WS + GKD 协议兼容 | 1 天 |
| CI 出包 + provisioning + 文档 | 1 天 |
| **合计** | **约 5 天（MVP）** |

## 3. 方案 B：`app_process` + UiAutomation（不装 APK）

### 3.1 做法

复用 `/system/bin/uiautomator` 的启动方式：

```bash
su -c "app_process -Djava.class.path=/data/local/tmp/driver.jar /system/bin com.example.driver.Main"
```

Java 侧用反射构造连接（`UiAutomation` / `UiAutomationConnection` 是隐藏 API），**跳过 `waitForIdle`**，直接 `getRootInActiveWindow()` 遍历；手势用 `UiAutomation.injectInputEvent`，也可以继续沿用现成的 `input`。

### 3.2 优点

- **零安装**：不装 APK、不开无障碍开关，用户侧没有配置；
- 树质量与 A 相同（同一份 a11y 数据）；
- 截图可用 `UiAutomation.takeScreenshot()`，同样不需要 ffmpeg；
- 构建产物只有一个 dex/jar，便于随服务分发。

### 3.3 硬伤

| 问题 | 说明 |
| --- | --- |
| **必须 root** | 非 root 设备直接不可用 |
| **进程生命周期** | 普通进程，父 shell 结束即退出；需自写守护 / 开机自启（Magisk/KernelSU 模块或 init 脚本） |
| **隐藏 API** | 反射 `UiAutomation` / `UiAutomationConnection`，Android 版本升级可能失效 |
| **无系统保活** | 没有前台服务/无障碍服务的优先级，被 LMK 清理的概率更高 |
| **SELinux** | KernelSU（`u:r:ksu:s0`）较宽松，换 Magisk 或其他 root 方案可能踩到策略 |
| **输入能力弱** | 文本输入要自己注入按键或用剪贴板，不如 `ACTION_SET_TEXT` |
| **工具链** | 需要 `javac + d8`（Termux 可装 openjdk，d8 是纯 Java 可运行），比 Gradle 出 APK 更手工 |

### 3.4 工作量（估）

2–4 天可做出原型，但**维护成本显著高于 A**（每次 Android 大版本都要回归隐藏 API）。

## 4. A / B 对比

| 维度 | A 自研 a11y App | B app_process + UiAutomation |
| --- | --- | --- |
| 用户配置（无 root） | 装 APK + 开无障碍 | ❌ 不可用 |
| 用户配置（有 root） | 脚本安装+启用，0 步人工 | 无需安装，但需守护脚本 |
| 覆盖面 | root + 非 root | 仅 root |
| 树质量 | 完整 a11y | 相同 |
| 截图 | `takeScreenshot` | `UiAutomation.takeScreenshot` |
| 文本输入 | `ACTION_SET_TEXT`（含中文） | 反射注入 / 剪贴板 |
| 进程存活 | 无障碍/前台服务，系统可恢复 | 随 shell 退出 |
| 开机自启 | `BOOT_COMPLETED` | 自建模块/脚本 |
| 隐藏 API | 无 | 有 |
| 跨版本稳定性 | 高 | 中低 |
| 构建 | Gradle + AGP（CI 出 APK） | javac + d8 |
| 分发 | APK 签名安装 | 推 dex + 启动脚本 |
| 失败模式 | 被 ROM 杀无障碍 | 被清理 / SELinux / API 变更 |

**判断**：

- 目标设备**全部有 root** 且"一个 APK 都不想多装" → B 可作候选，但先用 A 验证树质量再决定；
- 目标里有**非 root 设备**，或希望长期免维护 → **A**；
- 能力最终服务于**自己的目标 App** → 把 `A11yService` 并进目标 App，配置最少。

## 5. GKD 在开发 / 测试阶段的定位

### 5.1 能省什么

| 用途 | 收益 | 成本 |
| --- | --- | --- |
| 协议与树结构参考 | 不必自己设计快照 JSON，直接对齐 `ComplexSnapshot` | 0 |
| 真机 oracle | 同一屏各抓一次，逐字段 diff，快速发现漏节点/漏文本 | 约 0.5 天写对比脚本 |
| 客户端联调 | UI / WS / Agent API 立刻可在真机验证，不必等 APK | 0（已完成） |
| 选择器语义验证 | 对齐 `click/clickCenter/swipe/back` 行为 | 0 |
| 回退驱动 | 某些设备装不了 App 时仍可用 | 0（已实现 `--driver gkd`） |

### 5.2 不能省什么 / 风险

- **不能替写无障碍服务**：App 本身的开发量不变；
- **性能不可外推**：GKD 在有 root 时走特权截图与特权注入（`privilege.tap`），比纯 a11y 更快更稳；
- **会继承它的取舍**：可见性过滤、`MAX_DESCENDANTS_SIZE=4096`、vid 规则等；当 oracle 可以，当规范抄要小心；
- **版本差异真实存在**：旧版 `isClickable` / 新版 `clickable`，必须 pin 版本并归一化；
- **开启成本**：GKD 的 HTTP 服务需要手动开一次（仅开发期可接受）。

### 5.3 建议

只在开发/测试期使用，并且把**协议兼容**写成验收标准：
同一份客户端代码，`--driver gkd` 与 `--driver a11y` 都能跑通，即视为合格。

## 6. 推荐架构

```text
┌ 目标 App 内（或独立驱动 APK）─────────────────┐
│ A11yService                                    │
│  · getRootInActiveWindow → 快照 JSON            │
│  · takeScreenshot → WebP                        │
│  · dispatchGesture / ACTION_SET_TEXT            │
│  · 本地 HTTP :8888（GKD 兼容 /api/*）            │
└───────────────┬────────────────────────────────┘
                │ 127.0.0.1
        gkd-vision 服务（现有代码）
        ├─ --driver a11y（新增，协议同 gkd）
        ├─ --driver gkd（开发期 oracle / 回退）
        └─ UI + Agent API
```

要点：**自研 App 直接实现 GKD 的 `/api/*` 形状**，服务端只加一个 driver 别名；
开发期用 GKD 验证，产线换成自家 App，客户端零改动。

需要对齐的最小协议（与 GKD 一致，`gkd-inspect/src/features/device-control/api.ts` 同款）：

```text
POST /api/getServerInfo     → { device, gkdAppInfo }
POST /api/captureSnapshot   → { id, appId, activityId, screenWidth, screenHeight,
                                isLandscape, appInfo, gkdAppInfo, device,
                                nodes:[{ id, pid, attr:{ name, id, vid, text, desc,
                                  clickable, longClickable, editable, visibleToUser,
                                  left, top, right, bottom, width, height,
                                  childCount, index, depth } }] }
POST /api/getScreenshot     → image/webp 二进制（{ id }）
POST /api/execSelector      → { selector, fastQuery, action, position, swipeArg }
响应头：GKD-RPC-Status: ok | error（error 时 body 为 { code, message }）
```

## 7. 里程碑与工作量

| 阶段 | 内容 | 估时 |
| --- | --- | --- |
| P0 | 固化协议 contract + GKD 对照脚本 | 0.5 天 |
| P1 | A11y App：服务 + 快照 JSON + 截图 | 2 天 |
| P2 | 手势 + `SET_TEXT` + 选择器lite + HTTP | 1.5 天 |
| P3 | CI 出包 + root 一键 provisioning + 文档 | 1 天 |
| **合计** | | **约 5 天** |

## 8. 待决策

1. 目标设备是否**全部可 root**？（决定 B 是否进入候选）
2. 能否把一个 **APK / 无障碍服务**随目标服务一起分发？（决定 A 的配置能否降到"只开一次开关"）
3. 是否接受"把 `A11yService` 并进目标 App"？（配置最少，但耦合最高）

## 附录：本机实测与引用

| 项 | 数据 |
| --- | --- |
| `uiautomator dump`（root，3 次） | 全部 `ERROR: could not get idle state` |
| `dumpsys activity top` | 10045ms / 145291B / 1493 行 / 0 处 `text=` / 4 个 View Hierarchy |
| 设备 | Redmi 25102RKBEC，Android 16，1200×2608，KernelSU（`u:r:ksu:s0`） |

引用：

- [DumpCommand.java](https://raw.githubusercontent.com/aosp-mirror/platform_frameworks_base/master/cmds/uiautomator/cmds/uiautomator/src/com/android/commands/uiautomator/DumpCommand.java)
- [UiAutomationConnection.java](https://raw.githubusercontent.com/aosp-mirror/platform_frameworks_base/master/core/java/android/app/UiAutomationConnection.java)
- [UiAutomation.java](https://raw.githubusercontent.com/aosp-mirror/platform_frameworks_base/master/core/java/android/app/UiAutomation.java)
- [mobilewright#117 · uiautomator dump fails on apps with continuous animation](https://github.com/mobile-next/mobilewright/issues/117)
