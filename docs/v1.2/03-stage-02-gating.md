# v1.2 · 03 阶段 S2 文档：门控诊断

> 状态：完成（2026-11-25）　对应计划：[02-plan.md](02-plan.md) §4
> 人日：实际约 3.8 / 计划 5

## 1. 完成内容

| 任务 | 状态 | 说明 |
| --- | --- | --- |
| S2-T1 判定算法 | ✅ | `src/gating.mjs`：非系统包且 `nodeCount ≤ 2` → `gated=true, reason=tree-hidden` |
| S2-T2 状态暴露 | ✅ | `/api/state`、`/api/fingerprint` 增加 `gating` |
| S2-T3 诊断接口 | ✅ | `POST /api/diagnose`：`gating` + `hint` + 兼容命令 |
| S2-T4 兼容提示 | ✅ | 只给建议，不自动修改系统设置 |
| S2-T5 真机验证 | ✅ | 见 §2 |
| S2-T6 单测 | ✅ | 6 条断言（门控/系统包/无帧/提示） |
| S2-T7 文档 | ✅ | 本文 |

## 2. 真机验证（微信）

| 条件 | 结果 |
| --- | --- |
| 仅自研服务 | `gated=true`，`reason=tree-hidden`，`nodeCount=1`，`hint` 有值 |
| 开启兼容（Select to Speak） | `gated=false`，`reason=ok`，`nodeCount=376` |
| B 站（正常应用） | `gated=false` |

## 3. 判定规则与误判风险

- 阈值 `≤2` 覆盖"只有根 FrameLayout + 一个容器"的典型门控形态；
- 系统界面（`com.android.systemui`、桌面、设置等）白名单排除，避免锁屏/桌面误报；
- 白屏/加载页可能误报为门控——因此只作为**提示**，不阻断抓取。

## 4. 遗留

| ID | 描述 | 闭环 |
| --- | --- | --- |
| ISSUE-043 | 白屏/加载页可能误报 `gated` | v1.3 结合截图特征 |
| ISSUE-044 | 未自动执行兼容开关（有意为之） | 保持人工确认 |
