# v1.1 · 03 阶段 S1 文档：页面指纹与点击后断言

> 状态：完成（2026-11-25）　对应计划：[02-plan.md](02-plan.md) §3
> 人日：实际约 5.5 / 计划 6

## 1. 完成内容

| 任务 | 状态 | 说明 |
| --- | --- | --- |
| S1-T1 指纹模块 | ✅ | `src/fingerprint.mjs`：关键文本按面积取前 5、过滤时间/纯数字、sha1 前缀 16 位 |
| S1-T2 指纹接口 | ✅ | `POST /api/fingerprint`，`GET /api/state` 内联 `fingerprint` |
| S1-T3 断言模块 | ✅ | `src/asserts.mjs`：文本出现/消失、指纹变化、图像差分（`magick compare -metric AE`） |
| S1-T4 act 路由 | ✅ | `POST /api/act`：可选 `expectPackage` 前置校验、超时、诊断信息 |
| S1-T5 tapText | ✅ | 精确匹配优先、回退包含匹配；选择器点击失败回退坐标 |
| S1-T6 单测 | ✅ | 指纹 9 条断言 |
| S1-T7 真机用例 | ✅ | 微信/B 站页面指纹、act 成功与失败、tapText 精确选择 |
| S1-T8 文档 | ✅ | 本文 |

## 2. 关键实现

- **指纹**：`sha1(package + 面积最大的 5 个文本)`；过滤 `12:30`、`338.6万` 这类漂移文本，避免同页哈希抖动。
- **断言**：每次轮询都重新抓帧（a11y 驱动一轮约 400–700ms），支持 `text` / `textGone` / `fingerprintChange` / `imageDiff` 四种。
- **act**：动作前后各取一次指纹；`expectPackage` 不匹配直接返回 `PAGE_MISMATCH`，避免"在错误的应用里乱点"。
- **诊断**：失败响应带 `fingerprintAfter` 与 `details.checks`，能直接看出"在哪个页面、哪条断言没过"。

## 3. 真机测试

| 用例 | 结果 |
| --- | --- |
| 微信页面指纹 | `package=com.tencent.mm`，`nodeCount=1`，`title` 为空（a11y 被屏蔽） |
| B 站页面指纹 | `package=tv.danmaku.bili`，5 条关键文本，哈希稳定 |
| act 成功（点评论后 `text=罗本真`） | `verified=true`，**198ms / 1 次** |
| act 失败（`text=不存在的XYZ`） | `verified=false`，**1272ms / 3 次**，返回指纹与 `checks` |
| `expectPackage` 不匹配 | 返回 409 `PAGE_MISMATCH`（单测与手工各一次） |
| tapText 精确优先 | 修复前点"评论"误中"评论详情"；修复后精确命中 `评论` |

## 4. 度量

| 指标 | 目标 | 实测 |
| --- | --- | --- |
| 指纹耗时（复用帧） | ≤700ms | 411ms（微信，含 visual hash 调用前的抓帧） |
| 断言成功耗时 | ≤1.5s | 198ms（1 次轮询） |
| 断言失败耗时 | ≈timeout | 1272ms（timeout 800ms + 最后一轮抓帧） |
| 单测 | — | 9 条断言通过 |

## 5. 遗留问题

| ID | 描述 | 闭环 |
| --- | --- | --- |
| ISSUE-026 | 微信等无 a11y 应用指纹只剩包名 | S2 已补视觉 dHash（见 S2 文档） |
| ISSUE-027 | `imageDiff` 未在真机用例中验证 | S3 补测 |
| ISSUE-028 | 断言超时未考虑动画中间态 | 记录，v1.2 |
