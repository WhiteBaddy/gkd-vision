# 可行性方案：实时看见 + 操控手机屏幕

> 结论：**可行，已在本机跑通两条路。**
>
> - **root 路线**（本机推荐）：`screenrecord | ffmpeg` 出流 + `input` 注入，实测 **9.5fps**，完全不依赖 GKD。
> - **GKD 路线**：复用 GKD 的 HTTP 调试协议（`inspect` 用的就是这套），**截图 + 控件树 + 坐标手势**都有，代价是 1–3fps。
>
> 两条路的对外接口完全一致（`/api/see`、`/api/tap`、`/ws`），换驱动只换一个参数。

## 1. 先说清楚：为什么「实时看屏」不能只靠一个网页

`gkd-kit/inspect` 是个纯前端审查工具，**自己看不见屏幕**。它的实时能力来自 README 里那句「连接调试 GKD 内部 HTTP Server」——连的是手机里 GKD App 开的本地服务。

Android 的权限模型决定了「看屏幕 + 注入触摸」必须由三类角色之一完成：

| 角色 | 截图 | 控件树 | 注入触摸 | 文本输入 |
| --- | --- | --- | --- | --- |
| 无障碍服务（GKD / 自研 App） | ✅ `takeScreenshot` | ✅ 完整 a11y 树 | ✅ `dispatchGesture` | ❌（协议层没有） |
| root（本机 KernelSU） | ✅ `screencap`/`screenrecord` | ❌（`uiautomator dump` 在本机不可用） | ✅ `input` | ✅ ASCII |
| adb shell | ✅ | ✅ `uiautomator` | ✅ | ✅ ASCII |

Termux 本身只是普通 app uid，三样都做不了——所以必须选一个「执行体」放在手机里。我们选了 root（本机已有）和 GKD（已装、协议现成）。

## 2. GKD 路线的事实核验（不是猜的）

| 结论 | 证据 |
| --- | --- |
| 路由固定为 8 个 `POST /api/*` | [`InspectionServer.kt`](https://github.com/gkd-kit/gkd/blob/main/gkd-app/src/commonMain/kotlin/li/gkd/app/network/inspection/InspectionServer.kt)：`getServerInfo` `getSnapshot` `getScreenshot` `captureSnapshot` `getSnapshots` `deleteSnapshot` `updateSubscription` `execSelector` |
| 「看」= 无障碍截图 + 控件树 | [`DebugService.kt`](https://github.com/gkd-kit/gkd/blob/main/gkd-app/src/androidMain/kotlin/li/gkd/app/service/DebugService.kt) `captureSnapshot = { SnapshotCaptureHost.capture() }`；[`SnapshotCaptureHost.kt`](https://github.com/gkd-kit/gkd/blob/main/gkd-app/src/androidMain/kotlin/li/gkd/app/snapshot/SnapshotCaptureHost.kt) 先 `AccessibilityService.takeScreenshot`，失败再走特权截图，编码 WebP q85 |
| 「操控」= 无障碍手势 | [`ManualAction.kt`](https://github.com/gkd-kit/gkd/blob/main/gkd-app/src/androidMain/kotlin/li/gkd/app/matching/action/ManualAction.kt)；[`ActionPerformer.kt`](https://github.com/gkd-kit/gkd/blob/main/gkd-app/src/androidMain/kotlin/li/gkd/app/matching/action/ActionPerformer.kt) 动作集 `click/clickNode/clickCenter/longClick*/swipe/back/none` |
| `position.x/y` 是**屏幕绝对坐标** | [`RulePositionCompilation.kt`](https://github.com/gkd-kit/gkd/blob/main/gkd-app/src/commonMain/kotlin/li/gkd/app/subscription/RulePositionCompilation.kt)：`x`/`y` 求值后原样使用，只有 `left/right/top/bottom` 相对节点；`inspect` 的 [`rule_composer.ts`](../inspect/gkd-inspect/src/features/snapshot-inspector/rule_composer.ts) 也这么生成 |
| `[depth=0]` 能匹配窗口根节点 | [`A11yQueryContext.kt`](https://github.com/gkd-kit/gkd/blob/main/gkd-app/src/androidMain/kotlin/li/gkd/app/matching/query/A11yQueryContext.kt) 的 `getCacheDepth`；空选择器会被 `SelectorParser` 判为语法错误，所以锚点用 `[depth=0]` |

推论：一次 `captureSnapshot` = 控件树 + 落盘截图；`execSelector` + `position{x,y}` = 任意像素点击。**「眼」和「手」都现成。**

## 3. 两条路的实测

> 驱动选型（自研无障碍 App / app_process / 开发期用 GKD）的完整对比见
> [driver-selection.md](driver-selection.md)。

设备：Redmi 25102RKBEC，Android 16，1200×2608 @120Hz，KernelSU。

### root 路线（`--driver root`）

```text
su -c "screenrecord --output-format=h264 --time-limit 180 --size 600x1304 --bit-rate 3M -"
  │
  └─▶ ffmpeg -f image2pipe -vcodec mjpeg
        │  （Node 侧按墙钟节流到 N fps，解析 JPEG SOI/EOI）
        └─▶ WS 二进制帧 → canvas
```

| 项 | 实测 |
| --- | --- |
| 帧率 | **9.2–9.5 fps**（限 10；理论上限取决于 CPU 解码） |
| 帧大小 | 600×1304 JPEG，42–59KB |
| CPU | 约 0.5 核（解码 120fps H.264 是主要开销） |
| 首帧延迟 | ≈3.5s（screenrecord 编码器初始化） |
| `input tap` | 52ms |
| `input swipe`（220ms 手势） | 314ms 端到端 |
| `screencap -p` 单张 | 560–720ms / 680KB（≈1.5fps，仅兜底） |
| `screencap` 原始帧 | 200–215ms / 12.5MB |
| `uiautomator dump` | ❌ `could not get idle state`（该 ROM 不可用） |

优点：快、无控件树依赖、能发文本/按键。缺点：没有语义树；screenrecord 单次 180s，断了要重启（约 0.4s 断档）。

### GKD 路线（`--driver gkd`）

| 项 | 预估/实测 |
| --- | --- |
| 帧率 | 1–3 fps（每帧一次完整快照） |
| 帧大小 | WebP q85，约 150–350KB |
| 控件树 | ✅ 完整（text/vid/class/bounds/clickable…），与 inspect 快照同构 |
| 输入 | 节点点击 / 坐标点击 / 滑动 / 返回 |
| 前提 | GKD 里手动开一次 HTTP 调试服务 |

### mock 路线（`--driver mock`）

SVG 画面 + 假树 + 点击态。用来在没有真机干扰的情况下验证「抓帧 → WS → 浏览器 → 点击 → 回显」整条链路（已通过，含 tap/swipe 与动作回执）。

## 4. 能力矩阵

| 能力 | root | gkd |
| --- | --- | --- |
| 实时画面 | ✅ ~10fps | ⚠️ 1–3fps |
| 控件树 / 控件框 | ❌ | ✅ |
| 任意像素点击 / 长按 | ✅ | ✅ |
| 滑动 | ✅ | ✅ |
| 返回 / 桌面 / 多任务 | ✅ `input keyevent` | ⚠️ 仅返回 |
| 文本输入 | ✅ ASCII | ❌ |
| 音量/电源键 | ✅ | ❌ |
| 按文本点控件 | ❌ | ✅ `[text="…"]` |
| FLAG_SECURE 页面 | ⚠️ 黑图 | ⚠️ 黑图 |
| 需要 root | ✅ 是 | ❌ 否（但要开 GKD 服务） |

两者互补：**要语义就用 gkd，要流畅就用 root**，接口一致。

## 5. 三条路线对比

| | A. root 流（**已实现**） | B. GKD 协议（**已实现**） | C. 自研无障碍 App |
| --- | --- | --- | --- |
| 改造量 | 0（不用装新东西） | 0（开一个开关） | 要写 Kotlin + 打 APK |
| 帧率 | 10fps（可调） | 1–3fps | 10–20fps 可达 |
| 控件树 | ❌ | ✅ | ✅ 可自定 |
| 文本输入 | ASCII | ❌ | 可实现 `setText` |
| 门槛 | root | 无 root | 开发 + 签名 + 安装 |
| 适合 | 自动化/Agent 闭环 | 语义化审查、规则调试 | 产品化、脱离 GKD |

C 的关键难点不在代码，而在**构建**：Termux 没法跑 Android SDK（x86_64 工具链），得用 GitHub Actions 出 APK。所以先做 A/B，C 作为二期。

## 6. 如果要并进 `gkd-kit/inspect`

`inspect` 是纯 Vue3 浏览器应用，GKD 允许跨域，理论上浏览器能直连 `http://<device>:8888`。但实时镜像更适合落在项目里：

```text
gkd-inspect/src/features/live-control/
  frameLoop.ts     // 抓帧循环：串行、过期丢弃、可暂停
  LiveScreen.vue   // canvas 渲染 + 控件框 + 指针手势
  LiveControlView.vue
gkd-inspect/src/pages/live/LivePage.vue   // 路由 /live
```

注意项目现有硬约束（`gkd-inspect/AGENTS.md`）：

- 状态只能在命名 action 里经 `commit()`/`commitIncrement()` 提交，`loading/error/进度`交给统一任务机制；
- 禁止 `watch` 驱动业务流程 → 抓帧循环由挂载时的 action 显式启动；
- 原生标签白名单（`eslint-rules/native-element-allowlist.ts`）里没有 `canvas`，要先加；
- 跨 feature 依赖要在 `eslint-rules/import-boundaries.ts` 声明。

可复用：`entities/snapshot` 的节点类型与树渲染、`entities/selector` 的选择器生成、`features/device-control/api.ts` 的 RPC 错误处理（`GKD-RPC-Status` 头 + 旧版 `__error` 体）。

## 7. 风险与对策

| 风险 | 对策 |
| --- | --- |
| screenrecord 180s 上限 | 驱动自动重启，0.4s 断档；也可改成短片段循环 |
| 流断/黑帧 | 6s 无帧自动重启；`--stream=false` 退化到 screencap |
| CPU/发热 | 帧率与码率可调（`--fps`、`--bitrate`），默认 10fps/3M |
| 隐私 | 默认只监听 127.0.0.1；画面含输入法/通知，局域网暴露需自行评估 |
| root 依赖 | 没有 root 的机器用 gkd 驱动即可（接口不变） |
| 误触 | 操作真实设备，脚本应先 `/api/see` 判断再点 |

## 8. 下一步

1. root 驱动补控件树：试 `dumpsys activity top` / `uiautomator`（Android 16 上失败）/ 或直接上自研 a11y App。
2. 中文输入：`input text` 不支持 CJK，需要 ADBKeyboard 或自研 IME 广播。
3. 录制回放：把 `tap/swipe` 序列 + 关键帧存成脚本，做「轨迹回放」。
4. 若要做成产品：C 路线（自研 a11y App，`AccessibilityService` + 前台服务 + WebSocket）是终局。

## 9. 事故复盘：一次 108 个 ffmpeg 的 fork 风暴

开发期间真机实测时，Termux 里的 DSH 与 Hermes 同时被杀。系统事件日志给出直接证据：

```text
11-25 00:39:22  am_kill : [0,5212,ffmpeg,0,Trimming phantom processes,67552]
              ...（同一秒共 108 条 ffmpeg 被杀）
```

**成因**：`screenrecord --time-limit 180` 到点退出时，`record.close`、`ffmpeg.close`、
`record.error` 三个事件各自触发了一次重启，且没有单飞保护 → 重启互相叠加，
每次失败又立即再触发 → 一秒内 fork 出上百个 ffmpeg。

**后果**：超过 Android 的 phantom 进程上限后，ActivityManager 执行
`Trimming phantom processes`，把该 app 的 phantom 进程集合整体清理——Termux 的 shell 会话
（DSH、Hermes）也被一起带走；Termux app 自身进程存活，随后被守护脚本重新拉起。

**修复**（`src/root.mjs`）：

1. 单飞：`pipeline` 存在时不允许再 spawn；旧管线的 close/error 用 generation 令牌作废；
2. 重启只有一条路径 `#scheduleRestart`，指数退避 400ms→6s；
3. 熔断：20 秒内 5 次重启 → 停流并降级 screencap；
4. `screenrecord` 用 pid 文件（固定名）跟踪，停止/重启时 `kill -9`；启动时先清掉上次残留；
5. 内存闸门 `MemAvailable < 1.5GB` 不启流；
6. 退出时（SIGINT/SIGTERM/exit）清理子进程。

**验证**（`tools/storm-test.sh`）：

| 场景 | 结果 |
| --- | --- |
| 模拟瞬时失败 20s | 5 次重启后熔断，degraded=true，fps 0.84（screencap），无残留进程 |
| 真录屏 20s、4s 切片 | max ffmpeg=1、max screenrecord=1、fps 7.45、退出后无残留 |

**可选加固**：`device_config put activity_manager max_phantom_processes 128`（需 root，持久化）。

**教训**：凡是会给设备 fork 子进程的驱动，必须把「进程数上限 + 退避 + 熔断」当作硬约束，
而不是异常处理。
