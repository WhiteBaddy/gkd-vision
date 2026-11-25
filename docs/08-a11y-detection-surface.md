# 08 · 合法辅助机制的可检测性分析

> 日期：2026-11-25　设备：Redmi 25102RKBEC / Android 16 / KernelSU
> 前置：[07-wechat-a11y-options.md](07-wechat-a11y-options.md)（微信门控实验与方案对比）
> 问题：采用"自研服务 + Select to Speak 共启"这套**合法配置**后，微信还能检测到吗？通过什么方式？

## 1. 结论

| 问题 | 答案 | 依据 |
| --- | --- | --- |
| 能检测到"有辅助服务在运行"吗 | **能** | 已证实（见 §2） |
| 能检测到是我们的服务吗 | **能** | 包名与能力标志均公开（见 §3） |
| 能检测到"在模拟点击"吗 | 大概率能 | 事件属性 + 行为特征；本机未实测（见 §4） |
| 现在会因此拦截吗 | **没有** | 共启可信服务后树照常导出（376 节点） |
| 会不会记入风控 | 很可能 | 外部无法证实 |

核心区分：**"能看到"≠"会处置"**。微信当前选择的是"白名单放行"，而不是"检测到就阻断"。

## 2. 已证实的检测面

`dumpsys accessibility` 显示微信注册为无障碍状态客户端：

```text
Registered clients:{ [com.tencent.mm] ... [dev.everything.vision] ... }
```

配合 1↔376 实验（仅自研服务 → 1 节点；加 Select to Speak → 376 节点），可确定微信至少做了两层判断：

1. 是否存在启用的辅助服务；
2. 该服务是否被它认可（Select to Speak 认可，自研服务不认可）。

## 3. 我们这套暴露的字段

任何应用都可通过 `AccessibilityManager` / `AccessibilityServiceInfo` 读取：

| 字段 | 我们的值 | 风险信号 |
| --- | --- | --- |
| 组件名 | `dev.everything.vision/.A11yService` | 非白名单包 |
| `canRetrieveWindowContent` | true | 可读界面 |
| `canPerformGestures` | **true** | 可模拟点击（强信号） |
| `canTakeScreenshot` | **true** | 可截屏（强信号） |
| `isAccessibilityTool` | **false**（未声明，运行时仍为 false） | 非无障碍工具 |
| 运行时 capabilities | **161** = 读窗口内容(1) + 手势(32) + 截图(128) | 三项高风险能力同时具备 |
| `packageNames` | 未限制 | 监视全部应用 |
| 事件类型 | WindowStateChanged / ContentChanged | 常规 |
| 反馈类型 | feedbackGeneric | 常规 |

> "能读屏 + 能点 + 能截屏 + 非无障碍工具"的组合，在风控规则里几乎等同自动化工具。

## 4. 其它可能的检测手段

| 手段 | 说明 | 我们的状态 |
| --- | --- | --- |
| 注入手势的事件属性 | AOSP 中 a11y 注入的 `MotionEvent` 与真实触摸在 deviceId / 标志位上可能存在差异 | **未验证** |
| 本地端口探测 | 应用可连接 `127.0.0.1:8899` 探测本地服务 | **无鉴权**，额外暴露面 |
| Root 检测 | 管理器包 `me.weishu.kernelsu` 可见；`/system/bin/su` 存在且可执行；`su -c id` 可成功 | 设备为 KernelSU，**已证实暴露**（`ro.build.tags=release-keys`、`ro.debuggable` 为空，这两项正常） |
| 包安装检测 | 微信具备较宽包可见性，可查 `dev.everything.vision` | 暴露 |
| 行为特征 | 点击间隔过于规律、坐标落在非交互区、滚动速度异常 | 取决于脚本 |
| FLAG_SECURE | 敏感页禁止截屏 | 聊天页未开启，支付页可能开启 |

## 5. 微信看不到的

- **手势归属**：系统不提供"某次点击由哪个服务注入"的信息，只能通过"当前有哪些手势类服务"做相关性推断；
- 我们的内部逻辑、Termux 内文件、HTTP 请求内容；
- Select to Speak 是"挡箭牌"还是"真实用户"——合法机制的价值正在于它天然混在真实辅助用户中。

## 6. 降低暴露的合法做法（按性价比）

| 优先级 | 做法 | 收益 | 代价 |
| --- | --- | --- | --- |
| P0 | 本地 HTTP 加 token 鉴权，仅监听回环 | 关闭端口探测面 | 0.5 人日 |
| P0 | 任务结束即关闭兼容模式/自研服务 | 缩短暴露窗口 | 使用习惯 |
| P1 | `packageNames` 限定目标应用 | 去掉"全设备监视"信号 | 需按场景改配置 |
| P1 | 拆分 `canTakeScreenshot` 变体 | 减少能力信号 | 维护两套配置 |
| P2 | 优先非 a11y 通道（Intent/IME/通知） | 减少手势注入次数 | 每场景单独开发 |
| — | **不建议**伪造 `isAccessibilityTool=true` | — | 欺骗系统与商店策略，且并非真正无障碍工具 |

## 7. 待验证实验

| ID | 实验 | 目的 |
| --- | --- | --- |
| EXP-01 | 写一个探针 Activity，比较真实触摸与 `dispatchGesture` 的 `MotionEvent`（deviceId、flags、pressure、source） | 确认是否可被直接识别 |
| EXP-02 | 用另一应用尝试连接 `127.0.0.1:8899` | 证明端口暴露面 |
| EXP-03 | 限定 `packageNames` 后重复微信实验 | 确认能力/范围信号是否影响门控 |

## 8. v1.2 待办

| ID | 描述 | 预期 |
| --- | --- | --- |
| ISSUE-038 | 本地 HTTP 无鉴权，任何应用可调用 | v1.2（P0） |
| ISSUE-039 | 未验证 a11y 注入手势的事件特征 | v1.2（EXP-01） |
| ISSUE-040 | 服务未限定 `packageNames`，暴露全设备监视信号 | v1.2（P1） |

## 9. 风险声明

- 本文只做机制分析与记录，不提供任何伪装、挂钩或绕过检测的实现；
- 使用辅助服务自动化微信仍可能违反其用户协议，存在账号风险；
- 表中"未验证"项为推断，不应作为确定性结论使用。

## 10. 复验记录（2026-11-25）

```text
Bound services:
  Service[label=随选朗读, feedbackType[FEEDBACK_SPOKEN, FEEDBACK_VISUAL], capabilities=137, ...]
  Service[label=Vision Driver, feedbackType[FEEDBACK_GENERIC], capabilities=161,
          eventTypes=[TYPE_WINDOW_STATE_CHANGED, TYPE_WINDOW_CONTENT_CHANGED],
          notificationTimeout=100, requestA11yBtn=false]
```

- `isAccessibilityTool` 仍是 **false**：配置 XML 未声明该属性；
- `capabilities=161` 明确暴露"读屏 + 手势 + 截图"三件套；
- Root 暴露来自设备本身：`pm list packages` 可见 `me.weishu.kernelsu`，`/system/bin/su` 存在，`su -c id` 可执行；**与 APK 无关**（驱动以普通应用 uid 运行）。

## 11. 能否规避

| 项 | 能否规避 | 做法 | 代价/风险 |
| --- | --- | --- | --- |
| `isAccessibilityTool=false` | 技术上能（声明 true），**不建议** | — | 欺骗系统与商店策略；我们并非真正的无障碍工具；且微信未必据此判定 |
| capabilities 三件套 | 部分能 | 按需拆分（截图/手势分版本）、任务结束即停用 | 维护两套配置，使用变复杂 |
| 全设备监视信号 | 能 | `android:packageNames` 限定目标应用 | 每换目标要改配置 |
| Root 痕迹 | 能（设备侧） | KernelSU 的 App Profile 对微信"卸载模块"、隐藏管理器包名、SUSFS 等 | 属于设备级隐藏，可能影响其它 root 功能；本质仍是规避，风险自担 |
| 本地端口 | 能 | 令牌鉴权（token 存应用私有目录，Termux 用 root 读取） | 0.5 人日 |
| 包安装可见 | 能（有限） | 修改包名/重打包 | 破坏签名与升级链，不建议 |

**建议顺序**：先做端口鉴权与按需启停（纯安全收益），再评估是否需要 packageNames 限定；不伪造 `isAccessibilityTool`；root 隐藏属于设备配置，交给使用者决定。
