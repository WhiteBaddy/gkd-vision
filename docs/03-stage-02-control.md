# 03 · Stage S2 开发文档：操控与交付（能控）

> 状态：已完成（2026-11-25）　对应计划：[02-plan.md](02-plan.md) §4
> 版本：v0.2.0-beta　人日：实际约 5.7 / 计划 6

## 1. 阶段目标与范围

实现完整操控（点击/长按/滑动/返回/文本）与**协议兼容的端点**，提供 root 一键部署脚本，并在真机完成动作验证。

覆盖：FR-03、FR-04、FR-05、FR-06、FR-07、FR-09、FR-11；闭环 ISSUE-005（多窗口）。

## 2. 实际完成内容

| 计划任务 | 状态 | 说明 |
| --- | --- | --- |
| S2-T1 协议完整 | ✅ | `/api/execSelector`、`/api/text`、错误码（`INVALID_ARGUMENT` / `NODE_NOT_FOUND` / `PERMISSION_DENIED`） |
| S2-T2 动作映射 | ✅ | `click` `clickNode` `clickCenter` `longClick*` `swipe` `back` `none` |
| S2-T3 手势注入 | ✅ | `dispatchGesture`；需在配置中声明 `canPerformGestures=true`（S2 踩坑） |
| S2-T4 selector-lite | ✅ | `text/desc/vid/id/clickable/editable` 等值 + AND 组合；不支持关系运算符 |
| S2-T5 文本输入 | ✅（含兜底） | `ACTION_SET_TEXT` → 剪贴板粘贴 → 全选剪切清空 |
| S2-T6 多窗口 | ✅ | `activeRoot()`：优先 `windows` 中 `isActive` 的窗口 |
| S2-T7 deploy.sh | ✅ | 安装、启用、电池白名单、健康检查、幂等；更新后强制重绑服务 |
| S2-T8 契约测试 | ⚠️ 部分 | 选择器解析 8 个用例；协议 JSON 形状由真机用例覆盖 |
| S2-T9 真机动作测试 | ✅ | 查询/点击/滑动/文本/清空/错误路径（见 §4） |
| S2-T10 阶段文档 | ✅ | 本文 |

## 3. 关键实现决策

| 决策 | 原因 |
| --- | --- |
| 动作在前台线程 `dispatchGesture` + 主线程 Handler | 保证回调可靠；HTTP 线程只做解析 |
| 文本三层兜底（setText → paste → cut） | WebView 的 `ACTION_SET_TEXT` 返回 true 但不生效（实测） |
| `verifyText` 重试 3 次（120ms） | a11y 树更新滞后，避免误报 `applied=false` |
| 部署脚本先清空再设置无障碍服务 | 覆盖安装后系统不会自动重启服务，旧代码会继续跑 |
| 端口 8899 | 与 GKD 的 8888 并存，便于 oracle 对比 |

## 4. 测试记录

**单元测试**：15/15 通过（S1 7 + S2 8）。

```
LiteSelectorTest: 单属性、多属性 AND、editable、viewId、空/未知属性/尾随垃圾、isEmpty
```

**真机动作验证**（Redmi 25102RKBEC / Android 16 / KernelSU，目标：Via 浏览器）：

| 用例 | 结果 |
| --- | --- |
| `[text="对话"]` 查询 | ✅ matched=true |
| `[clickable=true]` 查询 | ✅ matched=true |
| `[editable=true]` 查询 | ✅ 命中输入框 |
| `clickCenter (10,600)` | ✅ result=true，121/107/112ms |
| `swipe 1500→1400 @150ms` | ✅ result=true，157/155ms |
| 文本写入 `vision-test-123` | ✅ 走 paste 兜底，节点文本命中（截图确认） |
| 清空输入框 | ✅ 走 cut 兜底，占位文案恢复 |
| 非法选择器 `[text="x"` | ✅ `GKD-RPC-Status: error` |
| 非法 JSON | ✅ `GKD-RPC-Status: error`，`INVALID_ARGUMENT` |

## 5. 度量

| 指标 | 目标 | 实测 | 判定 |
| --- | --- | --- | --- |
| NFR-02 点击端到端 | ≤300ms | 107–121ms | ✅ |
| 滑动（150ms 手势） | — | 155–157ms | ✅ |
| 选择器查询 | — | 12ms | ✅ |
| 文本输入（WebView） | — | 需 paste 兜底，含 150ms 等待 | ⚠️ 见 ISSUE-002 |
| 抓帧 | — | 390–690ms | ❌ ISSUE-015（S3） |

## 6. 遗留问题（同步至 02 §6）

| ID | 描述 | 预期闭环 |
| --- | --- | --- |
| ISSUE-002 | WebView 输入框 `ACTION_SET_TEXT` 无效，需剪贴板粘贴；会弹键盘与剪贴板提示 | v1.1（原生 EditText 优先；输入法方案） |
| ISSUE-013 | `activityId` 仍为空（窗口事件未稳定落到服务） | S3（补窗口/事件缓存） |
| ISSUE-015 | 抓帧 390–690ms | S3（截图按需 + 缓存） |
| ISSUE-017 | 清空 WebView 输入框后节点文本为 `\n`（视觉正常） | v1.1（规范化） |
| ISSUE-018 | `back` 在键盘收起后会继续触发页面返回（实测触发一次） | S3（调用前检查 IME 窗口） |

## 7. 下一阶段输入

- 端点齐备（4 个），S3 只需在服务端加 `--driver a11y` 并做回退链；
- `deploy.sh` 已可重复执行，S3 的发布检查可复用；
- 文本/返回的边界行为已记录，S3 集成测试按 ISSUE-002/018 设计用例。
