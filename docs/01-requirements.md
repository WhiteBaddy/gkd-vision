# 01 · 需求分析与功能分析

> 状态：**已锁定**（Stage 3 校验通过，与 02 对齐）
> 版本：v0.2
> 上游：[00-feasibility.md](00-feasibility.md)
> 下游：[02-plan.md](02-plan.md)（阶段拆分与任务）
> 附件：[driver-selection.md](driver-selection.md)（A/B 选型依据）

## 0. 设计原则与取舍

本文所有取舍遵循 [开发规范](../../DEVELOPMENT-GUIDELINES.md)，三条总原则的落地：

| 原则 | 本项目落地 | 对应规范 |
| --- | --- | --- |
| 解耦 | `core`（能力）/ `adapters`（驱动）/ `shells`（APK、嵌入）三件套；协议与实现分离；驱动可插拔 | G-01 ~ G-04 |
| 傻瓜 | root 一键 0 步；非 root ≤ 3 步；错误码带动作；驱动自动回退；可选单包形态 | G-10 ~ G-14 |
| 全面 | a11y / root / gkd / mock 四种驱动；root 与非 root 双覆盖；P0 功能均有降级路径 | G-20 / G-21 |

**冲突裁决**：安全 > 傻瓜 > 全面 > 解耦。
典型体现：Q-03 默认不把服务并进目标 App（解耦），但保留 AAR 嵌入形态（傻瓜），
不为了"更解耦"牺牲单包体验，也不为了"更方便"突破系统授权。

## 1. 术语

| 术语 | 含义 |
| --- | --- |
| 驱动（driver） | 「看」与「控」的执行体，如 a11y App、root 脚本、GKD HTTP |
| 快照（snapshot） | 一次抓取得到的控件树 + 元信息（应用、Activity、屏幕尺寸） |
| 节点（node） | 快照里的一棵 a11y 节点：class/id/vid/text/desc/bounds/flags |
| 手势（gesture） | 点击、长按、滑动等注入操作 |
| 协议兼容 | 自研 App 对外暴露与 GKD `/api/*` 同形状的接口 |
| oracle | 开发期用来对照正确性的参照实现（此处为 GKD） |
| provisioning | 安装、授权、启用无障碍、电池白名单等一次性配置 |

## 2. 需求来源与追溯

`00-feasibility.md` 的 RC → 本文 FR/NFR 的映射（无遗漏，含"不做"）：

| RC | 承接 | 说明 |
| --- | --- | --- |
| RC-01 画面 | FR-02 | a11y `takeScreenshot` → WebP |
| RC-02 控件树 | FR-01 / FR-08 | 节点 + 前台应用信息 |
| RC-03 操控 | FR-03 / FR-04 / FR-05 | 手势与全局动作 |
| RC-04 文本 | FR-06 | `ACTION_SET_TEXT` 主路径 |
| RC-05 配置 | FR-11 / FR-12 | root 一键；非 root 引导 |
| RC-06 不复用 GKD | FR-09 / FR-10 | 自研驱动 + 协议兼容 |
| RC-07 root/非 root | FR-10 / FR-11 / FR-12 | 同一 App，两种启用方式 |
| RC-08 Agent 接口 | FR-09 / FR-14 | HTTP + 状态 |
| RC-09 镜像 UI | 复用现有 | `gkd-vision` 不改结构 |
| RC-10 语义定位 | FR-07 | selector-lite |
| RC-11 保活 | FR-13 | watchdog + 白名单 |
| RC-12 安全 | NFR-05 | 仅回环、日志脱敏 |
| RC-13 协议兼容 | FR-09 | 固定端点 |
| RC-14 安装升级 | FR-11 / FR-12 | 脚本化 |
| RC-15 审计 | FR-15 | 结构化日志 |

## 3. 功能需求（FR）

### FR-01 控件树快照 `P0`

- 描述：抓取当前活跃窗口的 a11y 树，输出与 GKD 同构的节点数组。
- 细节：遍历深度上限 64、节点上限 4096；跳过 `visibleToUser=false` 的子树（可通过参数关闭）；记录 `id/pid/vid/name/text/desc/clickable/longClickable/editable/visibleToUser/bounds/childCount/index/depth`。
- 验收：在聊天类、设置类、浏览器三类应用上，与 GKD 同屏快照对比，节点数差异 ≤ 5%，文本节点召回 ≥ 95%。

### FR-02 屏幕截图 `P0`

- 描述：`takeScreenshot()` 取图，编码 WebP（质量 70），返回 `image/webp`。
- 约束：单帧 ≤ 350KB（1080×2400 基准）；失败（FLAG_SECURE）返回明确错误码而非黑图。
- 验收：连续 100 次截图无失败、无 fd 泄漏；`FLAG_SECURE` 页面返回 `SCREENSHOT_PROTECTED`。

### FR-03 点击 / 长按 `P0`

- 描述：按屏幕绝对坐标点击或长按；也支持"命中节点后 `ACTION_CLICK`"。
- 验收：坐标点击命中率 100%（以截图圆点标记验证）；长按时长可配 200–2000ms。

### FR-04 滑动 `P0`

- 描述：坐标起点/终点 + 时长（50–3000ms）。
- 验收：列表滚动距离与手势参数线性相关，误差 < 10%。

### FR-05 全局动作 `P0`

- 描述：`back` / `home` / `recents`。
- 验收：三个动作各 20 次全部生效。

### FR-06 文本输入 `P1`

- 描述：对可编辑节点执行 `ACTION_SET_TEXT`；无法定位时退化为"聚焦 + 剪贴板粘贴"。
- 验收：中文/英文/数字/emoji 各 5 例成功；输入框内容与期望一致。

### FR-07 selector-lite `P1`

- 描述：支持 `[text="…"]`、`[desc="…"]`、`[vid="…"]`、`[id="…"]`、`[clickable=true]` 及它们的空格组合；命中后执行点击/长按/输入。
- 非目标：完整 GKD 选择器语法（>、+、-、正则等）不在 v1.0。
- 验收：10 条固定选择器在 3 个应用上命中正确节点。

### FR-08 前台应用信息 `P1`

- 描述：返回 `appId / activityId / 应用名 / 版本`，用于路由与审计。
- 验收：切换 5 个应用后字段全部正确。

### FR-09 协议兼容层 `P0`

- 描述：对外暴露 `/api/getServerInfo`、`/api/captureSnapshot`、`/api/getScreenshot`、`/api/execSelector`，响应头带 `GKD-RPC-Status`。
- 验收：现有 `gkd-vision --driver gkd` 指向该 App 时，UI 与 Agent API 全部可用。

### FR-10 驱动抽象与回退 `P0`

- 描述：服务端支持 `--driver a11y|root|gkd|mock`；启动时按 `a11y → root → gkd` 顺序探测可用性。
- 验收：任选两种驱动切换，客户端无感；驱动不可用时给出可读错误。

### FR-11 root 一键部署 `P0`

- 描述：`deploy.sh` 完成安装、启用无障碍、电池白名单、健康检查。
- 验收：新设备从零到 `/api/state` 返回 `ok` ≤ 60s，无需人工点击。

### FR-12 非 root 安装引导 `P1`

- 描述：首次启动引导开启无障碍；提供"检测未开启"提示与跳转。
- 验收：非 root 设备按引导 3 步内可用。

### FR-13 保活与自恢复 `P0`

- 描述：前台通知常驻；watchdog 检测服务与端口；掉线自动重建；开机自启。
- 验收：连续 2 小时压测无掉线；手动 `kill` 后 ≤ 10s 恢复。

### FR-14 健康检查与度量 `P1`

- 描述：`/api/state` 输出版本、驱动、fps、最近错误、节点数、内存。
- 验收：字段齐全，能被 `gkd-vision` 直接消费。

### FR-15 审计日志 `P2`

- 描述：记录每次操作的时间、动作、坐标/选择器、结果。
- 验收：日志可导出，敏感文本脱敏。

## 4. 非功能需求（NFR）

| ID | 需求 | 指标 | 验证方式 |
| --- | --- | --- | --- |
| NFR-01 | 快照性能 | 单次 ≤ 250ms（p95），节点 1000 时 | 真机压测 100 次 |
| NFR-02 | 操作延迟 | 点击端到端 ≤ 300ms（p95） | 时间戳日志 |
| NFR-03 | 稳定性 | 2h 连续运行无崩溃、内存增长 < 20MB | soak test |
| NFR-04 | 兼容性 | Android 11–16；HyperOS/MIUI 至少各 1 台 | 真机矩阵 |
| NFR-05 | 安全 | 仅 127.0.0.1；无外发；日志脱敏 | 抓包 + 代码审计 |
| NFR-06 | 资源占用 | 空闲 CPU < 3%，RSS < 80MB | `dumpsys`/`top` |
| NFR-07 | 可维护 | 纯逻辑单测覆盖率 ≥ 60% | CI 报告 |
| NFR-08 | 可观测 | `/api/state` 含版本/驱动/fps/error | 接口断言 |

## 5. 用例（UC）

### UC-01 Agent 看并点（P0）

- 前置：驱动就绪，`/api/state` 返回 ok。
- 主流程：`GET /api/see?save=1` → 读取截图与节点 → 决策坐标 → `POST /api/tap` → 再 `see` 校验。
- 异常：截图保护 → 返回 `SCREENSHOT_PROTECTED`，Agent 改用节点操作；节点为空 → 提示切换驱动。

### UC-02 人工镜像操作（P0）

- 主流程：浏览器打开镜像 → 画面 1–2fps 刷新 → 点击/滑动 → 手机立即响应。
- 异常：断流 → UI 显示重连状态，恢复后自动续帧。

### UC-03 文本输入（P1）

- 主流程：`see` 定位输入框 → `POST /api/text` → `see` 校验内容。
- 异常：节点不可编辑 → 返回 `NODE_NOT_EDITABLE`。

### UC-04 掉线恢复（P0）

- 主流程：watchdog 发现心跳中断 → 重建服务 → 上报事件。
- 异常：无障碍被系统关闭 → 标记 `A11Y_DISABLED`，提示重新启用。

### UC-05 一键部署（P0）

- 主流程：`deploy.sh` → 安装 → 启用 → 白名单 → 健康检查通过。
- 异常：MIUI 限制 → 输出引导链接与手动步骤。

### UC-06 驱动回退（P0）

- 主流程：a11y 不可用 → 自动探测 root 驱动 → 继续提供能力。
- 异常：都不可用 → 明确报错并给出建议。

## 6. 难点分析

| ID | 难点 | 影响 | 对策 | 验证 |
| --- | --- | --- | --- | --- |
| D-01 | ROM 杀无障碍/后台限制 | 服务掉线 | 前台通知 + 白名单 + watchdog + 自启 | 2h soak + 手动 kill |
| D-02 | 构建链路（Termux 无 Android SDK） | 无法出包 | GitHub Actions + Gradle 缓存 + 产物校验 | CI 出包 + `apksigner verify` |
| D-03 | 快照字段与 GKD 版本差异 | 客户端解析失败 | 归一化层 + 字段断言 + 双版本 fixture | 单测 + 真机 diff |
| D-04 | WebView/Compose 树稀疏 | 定位不到控件 | 坐标兜底；P2 引入 OCR | 三类应用抽查 |
| D-05 | 中文输入 | 输入失败 | `ACTION_SET_TEXT` 主路径 + 剪贴板兜底 | 中英数 emoji 用例 |
| D-06 | 选择器语义差异 | 命中错误 | 只实现 5 类属性 + 明确文档边界 | 固定用例集 |
| D-07 | 多窗口/分屏/悬浮窗 | 抓错窗口 | 取 `getWindows()` 中 `isActive` 的窗口 | 分屏场景手工验证 |

## 7. 需求锁定（v1.0）

| 范围 | 条目 |
| --- | --- |
| **v1.0（P0）** | FR-01/02/03/04/05/09/10/11/13 |
| **v1.x（P1）** | FR-06/07/08/12/14 |
| **v1.x+（P2）** | FR-15 |
| **明确不做** | 公网远程、多设备管理、完整 GKD 选择器、iOS、游戏注入 |

## 8. 技术栈选型

### 8.1 总体

| 层 | 选型 | 理由 |
| --- | --- | --- |
| 模块结构 | `driver-core`（AAR）/ `driver-app`（APK 壳）/ 服务端 `adapters` | G-02 三件套，支持独立 APK 与嵌入两种形态 |
| 驱动 App | Kotlin 2.0 + AGP 8.5 + Gradle 8.7，JDK 17 | 官方支持、CI 成熟 |
| 最低版本 | `minSdk 30`（`takeScreenshot` 起始版本），`targetSdk 35` | 覆盖 Android 11+ |
| UI | 无 Activity UI（仅 Service + 通知） | 减小体积与攻击面 |
| HTTP | 手写 `ServerSocket`（≈200 行，仅 127.0.0.1，串行） | 零依赖、可审计；NanoHTTPD 作为备选 |
| JSON | `org.json`（系统内置） | 零依赖，够用 |
| 构建 | GitHub Actions（Gradle cache） | Termux 无法跑 Android SDK |
| 服务端 | 现有 Node `gkd-vision`，新增 `--driver a11y` | 复用 WS/UI/Agent API |
| 测试 | JVM 单测（快照序列化/选择器）+ 真机 bash 集成 + GKD oracle diff | 纯逻辑可离线测 |

### 8.2 ADR 摘要

- **ADR-01｜选 A（APK）不选 B（app_process）**：B 需 root、进程无保活、依赖隐藏 API；A 覆盖 root 与非 root，root 下仍可零人工配置。代价是多一个安装步骤。
- **ADR-02｜对外协议兼容 GKD**：客户端（WS/UI/Agent API）零改动，开发期可用 GKD 当 oracle；代价是要跟随其字段命名（已用归一化层吸收差异）。
- **ADR-03｜手写 HTTP + `org.json`**：只监听回环、QPS 低、接口少；避免引入 Ktor 等重依赖导致 APK 膨胀。
- **ADR-04｜驱动可插拔 + 回退链**：`a11y → root → gkd`，应对不同设备与权限状态；代价是接口抽象层要多一层测试。
- **ADR-05｜快照节流**：同一毫秒内的并发请求合并，状态变化事件到达后 200ms 内不重复抓取；避免 Agent 高频轮询打爆主线程。
- **ADR-06｜core / adapters / shells 三件套**：`driver-core` 承载 A11yService、快照、手势与协议服务器；`driver-app` 只是安装与 provisioning 的壳；服务端用 adapters 接 a11y / root / gkd / mock。目标 App 若需单包，依赖 `driver-core` 并声明 Service 即可，核心零改动。代价：多一层模块边界与 AAR 发布流程。

## 9. 接口契约

```text
POST /api/getServerInfo    → { device:{...}, gkdAppInfo:{...} }
POST /api/captureSnapshot  → ComplexSnapshot
POST /api/getScreenshot    → image/webp（body: { id })
POST /api/execSelector     → { selector, fastQuery, action, position, swipeArg }
POST /api/state            → { version, driver, fps, nodeCount, lastError, uptime }
响应头：GKD-RPC-Status: ok | error；error 时 body 为 { code, message, path? }
```

错误码（v1.0）：`ACCESSIBILITY_DISABLED`、`SCREENSHOT_PROTECTED`、`SNAPSHOT_BUSY`、`NODE_NOT_FOUND`、`NODE_NOT_EDITABLE`、`INVALID_ARGUMENT`、`INTERNAL_ERROR`。

## 10. 数据模型（快照）

```jsonc
{
  "id": 1712,
  "appId": "com.example.app",
  "activityId": "com.example.app/.MainActivity",
  "screenWidth": 1200,
  "screenHeight": 2608,
  "isLandscape": false,
  "appInfo": { "id": "...", "name": "...", "versionCode": 1, "versionName": "1.0" },
  "gkdAppInfo": { "id": "dev.everything.vision", "name": "VisionDriver", "versionCode": 1, "versionName": "0.1.0" },
  "device": { "device": "...", "model": "...", "manufacturer": "...", "brand": "...", "sdkInt": 35, "release": "15" },
  "nodes": [
    { "id": 0, "pid": -1, "attr": {
        "name": "android.widget.FrameLayout", "id": null, "vid": null,
        "text": null, "desc": null,
        "clickable": false, "longClickable": false, "editable": false,
        "visibleToUser": true,
        "left": 0, "top": 0, "right": 1200, "bottom": 2608,
        "width": 1200, "height": 2608, "childCount": 1, "index": 0, "depth": 0 } }
  ]
}
```

归一化规则：`clickable/isClickable`、`longClickable/isLongClickable` 两个版本字段同时接受；缺失字段补默认值并计数上报（`normalizedFields`）。

## 11. 部署与配置

| 场景 | 步骤 | 目标耗时 |
| --- | --- | --- |
| root | `deploy.sh`：`pm install` → `settings put secure enabled_accessibility_services` → `accessibility_enabled=1` → `deviceidle whitelist` → `GET /api/state` 校验 | ≤ 60s，0 人工 |
| 非 root | 安装 APK → 打开 App → 跟随引导开启无障碍 → 返回校验 | 3 步 |

## 12. 验收标准（v1.0 DoD）

- [ ] FR-01/02/03/04/05/09/10/11/13 全部通过验收用例
- [ ] NFR-01/02/03/04/05 达标（真机数据记录在阶段文档）
- [ ] 现有 `gkd-vision` 在 `--driver a11y` 下 UI 与 Agent API 可用
- [ ] `deploy.sh` 在干净设备上一次通过
- [ ] 单测覆盖率 ≥ 60%，CI 出包可复现

## 13. 初始遗留问题

| ID | 描述 | 来源 | 影响 | 预期闭环 | 状态 |
| --- | --- | --- | --- | --- | --- |
| ISSUE-001 | MIUI/HyperOS 可能杀无障碍服务 | 00 R-01 | 服务掉线 | Stage 3（watchdog + 白名单） | 待处理 |
| ISSUE-002 | 中文/emoji 输入在部分输入法下失败 | D-05 | 输入不可用 | v1.1（剪贴板兜底成熟） | 待处理 |
| ISSUE-003 | WebView/Compose 树稀疏 | D-04 | 定位失败 | v1.1（OCR 兜底） | 待处理 |
| ISSUE-004 | 非 root 引导体验粗糙 | FR-12 | 配置步骤多 | v1.1 | 待处理 |
| ISSUE-005 | 多窗口选择策略未定 | D-07 | 抓错窗口 | Stage 2 | 待处理 |
| ISSUE-006 | 与 GKD 字段差异需持续回归 | D-03 | 客户端解析失败 | Stage 2 建立 fixture + 每版回归 | 待处理 |
| ISSUE-007 | 嵌入形态（AAR）与目标 App 的进程/通知/权限冲突未验证 | ADR-06 | 单包场景不可用 | v1.1（与目标 App 做一次集成验证） | 待处理 |

## 14. 与 00 的对齐检查

| 检查项 | 结果 |
| --- | --- |
| 每条 RC 都有承接或"不做" | ✅ 15/15 |
| 每条 P0 有可判定验收 | ✅ |
| 难点均有验证方式 | ✅ D-01~D-07 |
| 选型无悬空项 | ✅（NanoHTTPD 为备选，已注明触发条件） |
| 待决策项已裁决 | ✅ Q-01~Q-03 按开发规范裁决，结论见 00 §10 |
| 遵循开发规范 | ✅ 三条原则在 §0 落地，模块拆分见 ADR-06 |

## 15. 变更记录

| 日期 | 版本 | 变更 |
| --- | --- | --- |
| 2026-11-25 | v0.1 | 初稿：FR/NFR/UC、难点分析、需求锁定、ADR、接口契约 |
| 2026-11-25 | v0.2 | 按开发规范裁决 Q-01~Q-03；新增 §0 设计原则、ADR-06、ISSUE-007；Stage 3 校验通过后锁定 |

## 16. 遗留问题索引

本表保留 v1.0 立项时的 7 条；Stage 2 起新增的 ISSUE-008~012 统一登记在
[02-plan.md](02-plan.md) §6，避免出现两份真相。
