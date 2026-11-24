# gkd-vision

**实时看见 + 操控手机屏幕**的桥接服务：一个跑在 Termux 里的 Node 进程 + 一个网页镜像。
接口设计沿用 [`gkd-kit/inspect`](https://github.com/gkd-kit/inspect) 的「控件树 + 绝对坐标手势」模型，提供两种驱动：

| 驱动 | 「眼」 | 「手」 | 需要什么 |
| --- | --- | --- | --- |
| `root`（本机默认推荐） | `screenrecord \| ffmpeg` 实时 H.264 → JPEG 帧 | `input tap/swipe/text/keyevent` | root |
| `gkd` | GKD 无障碍截图（WebP）+ 控件树 | `execSelector`（坐标/节点/滑动/返回） | GKD App + 打开其 HTTP 调试服务 |
| `mock` | 合成 SVG 画面 | 内存里模拟点击 | 无 |

```text
┌── 手机 ───────────────────────────────────────────────┐
│ root 驱动:  screenrecord ─▶ ffmpeg ─▶ JPEG 帧          │
│              input tap/swipe/text ◀── 指令              │
│ gkd  驱动:  GKD a11y 截图 + 控件树  ⇄  HTTP :8888       │
└───────────────────────┬───────────────────────────────┘
                        ▼
      gkd-vision (Node, Termux, :7777)
        ├─ /ws        实时帧推流（二进制 JPEG/WebP + 节点树）
        ├─ /api/see   给 Agent「看」：截图落盘 + 控件树
        ├─ /api/tap…  给 Agent「动手」
        └─ /        浏览器实时镜像（点哪打哪）
```

## 安全边界（root 流驱动）

实时流会 fork 出 `screenrecord`（root）和 `ffmpeg`（本用户）两个子进程。Android 12+ 的
**PhantomProcessKiller** 会清理「没有可见界面却疯狂 fork」的进程，最坏情况会把 Termux 里
整个 shell 会话一起带走（本项目开发时就发生过一次：重启逻辑重复触发，108 个 ffmpeg 在一秒内
被系统清理，终端里的其他 Agent 也被牵连）。

因此驱动里写死了四条约束：

1. **单飞**：任何时刻最多 1 个 `screenrecord` + 1 个 `ffmpeg`，旧进程按进程组 + pid 文件杀干净才允许重启；
2. **退避 + 熔断**：重启延迟 400ms 起指数退避；20 秒内重启 5 次就永久停流，
   自动降级为 `screencap` 单帧（约 0.8fps），服务不中断；
3. **内存闸门**：`MemAvailable < 1.5GB` 时不启动实时流（`--force-stream` 可强制）；
4. **退出清理**：收到 SIGINT/SIGTERM 或进程退出时，杀掉 ffmpeg 和 root 侧的 screenrecord。

自检：

```bash
bash tools/storm-test.sh sim    # 模拟瞬时失败，验证熔断（安全，不真录屏）
bash tools/storm-test.sh real 20 4   # 真录屏 20s、4s 一切片，验证同时只有 1+1 个进程
```

## 快速开始

```bash
node server.mjs --driver root            # 本机 root：实时流 + input 注入（默认 10fps）
node server.mjs --driver root --fps 15 --bitrate 5M
node server.mjs --driver root --stream=false   # 退化为 screencap 单张抓帧（约 1.5fps）
node server.mjs --driver root --fps 8 --record-limit 180 --force-stream
node server.mjs --driver gkd             # 走 GKD HTTP 调试服务（默认 127.0.0.1:8888）
node server.mjs --driver mock            # 无设备时验证整条链路
```

浏览器打开 <http://127.0.0.1:7777/>（本机默认只监听 127.0.0.1；电脑上要看就加 `--host 0.0.0.0`）：

- **观察**：悬停高亮控件、点击选中、右侧看控件树、自动生成选择器（gkd 驱动有树；root 驱动只有画面）
- **点击 / 长按 / 滑动**：在画面上直接操作手机
- 滚轮缩放、拖拽平移、双击适应窗口；顶部可暂停、调帧率、开关节点框
- 右侧「选择器」页可直接执行 GKD 选择器（仅 gkd 驱动）

> 在手机上打开镜像页会「自己拍自己」出现无限递归，建议在电脑或 DSH 侧边栏里看。

## 给 Agent 用

```bash
# 看：截图落盘 + 控件树（root 驱动 nodes 为空）
curl -s "http://127.0.0.1:7777/api/see?save=1" | jq '{savedPath, appId, screenWidth, screenHeight, nodeCount:(.nodes|length)}'

# 点 / 长按 / 滑
curl -s -XPOST http://127.0.0.1:7777/api/tap       -d '{"x":540,"y":820}'
curl -s -XPOST http://127.0.0.1:7777/api/longpress -d '{"x":540,"y":820}'
curl -s -XPOST http://127.0.0.1:7777/api/swipe     -d '{"x1":540,"y1":1800,"x2":540,"y2":900,"duration":260}'

# 按键 / 文本（root 驱动；文本仅 ASCII）
curl -s -XPOST http://127.0.0.1:7777/api/key  -d '{"key":"back"}'
curl -s -XPOST http://127.0.0.1:7777/api/text -d '{"text":"hello world"}'

# 原始 GKD 调用（gkd 驱动）
curl -s -XPOST http://127.0.0.1:7777/api/exec -d '{"payload":{"selector":"[text=\"确定\"]","action":"click"}}'

# 纯文本控件树（给 LLM 看更省 token）
curl -s http://127.0.0.1:7777/api/tree.txt
```

Agent 的闭环就是：`/api/see?save=1` → 看 `savedPath` 那张图 → `/api/tap`。

## HTTP / WS 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/state` | 驱动、FPS、引擎能力、当前帧元信息 |
| GET | `/api/frame` | 当前帧（JPEG / WebP / PNG） |
| GET | `/api/tree` | 当前帧控件树（完整字段） |
| GET | `/api/tree.txt` | 缩进文本树 |
| GET | `/api/see?save=1&fresh=1` | 元信息 + 控件树（+ 截图落盘 `frames/`） |
| POST | `/api/tap` `{x,y,action?}` | 点击（`action` 可为 `clickCenter`/`longClickCenter`） |
| POST | `/api/longpress` `{x,y}` | 长按 |
| POST | `/api/swipe` `{x1,y1,x2,y2,duration}` | 滑动 |
| POST | `/api/back` / `/api/home` / `/api/recents` | 返回 / 桌面 / 多任务 |
| POST | `/api/key` `{key}` | `back` `home` `recents` `enter` `delete` `power` `wakeup` `volumeUp` … |
| POST | `/api/text` `{text}` | 仅 root 驱动，仅 ASCII |
| POST | `/api/exec` `{payload}` | 透传 GKD `execSelector` |
| POST | `/api/tapbytext` `{text}` | 按文本找节点并点击（需控件树） |
| POST | `/api/config` `{interval,cleanup,paused}` | 轮询驱动用 |
| POST | `/api/capture` | 立刻抓一帧 |
| WS | `/ws` | 帧推流 + 控制指令 |

WS：`{type:"frame",...}` 元信息后紧跟一帧**二进制图片**；约 1 秒一次 `{type:"tree",nodes}`；客户端可发 `tap/swipe/key/text/exec/config`。

## 本机实测

设备：Redmi 25102RKBEC（Android 16，1200×2608@120Hz，KernelSU root）

| 项目 | 实测 |
| --- | --- |
| root 实时流 | **9.2–9.5 fps**（限 10），600×1304 JPEG，42–59KB/帧，约 0.5 核 CPU |
| `input tap` | 52 ms |
| `input swipe`（220ms 手势） | 314 ms 端到端 |
| `screencap -p` 单张 | 560–720 ms，680KB（≈1.5fps，仅作 `--stream=false` 兜底） |
| `screencap` 原始帧 | 200–215 ms，12.5MB（喂 ffmpeg 可省 PNG 编码，但要多一次转码） |
| 流启动延迟 | ≈3.5 s（screenrecord 编码器初始化） |
| `uiautomator dump` | 该 ROM 上失败（`could not get idle state`），所以 root 驱动暂无控件树 |

## 目录

```text
server.mjs     HTTP + WS + 静态资源 + Agent API
src/root.mjs   root 驱动：screenrecord+ffmpeg 流、screencap 兜底、input 注入
src/gkd.mjs    GKD RPC 客户端（GKD-RPC-Status 头、旧版 __error 兼容）
src/vision.mjs 帧管线、节点归一化、坐标手势、锚点选择器探测
src/ws.mjs     极简 RFC6455 服务端（无依赖）
src/mock.mjs   模拟设备（SVG 画面 + 假控件树 + 点击态）
public/        镜像 UI（canvas 渲染 + 控件框 + 树 + 选择器控制台）
tools/probe.mjs WS 链路自检
frames/        /api/see?save=1 的落盘目录
```

## 已知边界

- **root 驱动没有控件树**：`uiautomator dump` 在这台机器上不可用；需要语义树就用 `--driver gkd`（GKD 的 a11y 树是现成的）。
- **文本输入**：`input text` 只吃 ASCII；中文要装 ADBKeyboard 之类输入法（未实现）。
- **FLAG_SECURE 页面**：`screenrecord`/`screencap` 都会是黑图。
- **screenrecord 上限**：单次最长 180s，驱动会自动重启续流（会有约 0.4s 断档）。
- **gkd 驱动**：`captureSnapshot` 每帧写入 GKD 历史，默认抓完即删；帧率上限 1–3fps。
- **需要手动开一次**：GKD 的 HTTP 服务与无障碍授权不对外暴露开关。
- **PhantomProcessKiller**：如果还想更保险，可以用 root 把上限调高（会持久化，需自行评估）：
  `su -c "device_config put activity_manager max_phantom_processes 128"`。本项目已把 fork 行为收敛到 1+1，正常不需要。

## 构建与发布（driver）

Android 驱动源码在 `driver/`（`driver-core` AAR + `driver-app` APK），由 GitHub Actions 构建，
推送到 `main` 即触发：

| 项 | 说明 |
| --- | --- |
| CI | `.github/workflows/build.yml`：JDK 17 + Gradle 8.7，产出 debug APK |
| 产物出口 | 滚动 release `ci-latest`（公开仓库可匿名下载） |
| 下载 | `https://github.com/WhiteBaddy/gkd-vision/releases/download/ci-latest/driver-app-debug.apk` |
| 失败排查 | 构建日志同 release 的 `build.log`（失败时上传） |
| 安装 | `su -c "pm install -r driver-app-debug.apk"` |

命令行验证：

```bash
curl -sL -o driver.apk https://github.com/WhiteBaddy/gkd-vision/releases/download/ci-latest/driver-app-debug.apk
su -c "pm install -r $PWD/driver.apk"
```

## 项目文档

按 [研发流程规范](../DEVELOPMENT-WORKFLOW.md) 组织：

| 文档 | 内容 |
| --- | --- |
| [../DEVELOPMENT-GUIDELINES.md](../DEVELOPMENT-GUIDELINES.md) | 开发规范：解耦 / 傻瓜 / 全面三条总原则（本项目取舍依据） |
| [docs/00-feasibility.md](docs/00-feasibility.md) | Stage 0：需求候选（RC）、可行性判定、风险、范围草案、已裁决的 Q-01~Q-03 |
| [docs/01-requirements.md](docs/01-requirements.md) | Stage 1：FR/NFR/UC、难点分析、需求锁定、技术栈 ADR、接口契约 |
| [docs/02-plan.md](docs/02-plan.md) | Stage 2：3 个阶段（S1/S2/S3）× 5–7 人日、任务清单、里程碑、遗留问题登记 |
| [docs/approach.md](docs/approach.md) | 可行性附件：协议依据、性能实测、事故复盘、路线对比 |
| [docs/driver-selection.md](docs/driver-selection.md) | 选型附件：自研无障碍 App / app_process / GKD 的对比与工作量 |
