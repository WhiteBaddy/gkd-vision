# Changelog

## v1.1.0 (2026-11-25)

### 新增

- **页面指纹** `POST /api/fingerprint`：包名 + 关键文本 sha1；`visual=1` 时附带 9×8 灰度 dHash（用于无 a11y 应用）。
- **动作断言** `POST /api/act`：动作后轮询校验文本出现/消失、指纹变化、图像差分；可选 `expectPackage` 前置校验（`PAGE_MISMATCH`）。
- **等待接口** `POST /api/wait`：仅断言不动作。
- **视觉定位** `POST /api/find`：NCC 粗到细模板匹配（region 或 base64 模板），返回坐标/分数/耗时。
- **便捷动作** `POST /api/tapText`（精确优先）、`POST /api/tapImage`。
- 单测 `tools/test-vision.mjs`（15 条断言）；真实任务脚本 `tools/task-bili-comment.mjs`。

### 改进

- `GET /api/tree` 支持 `fresh=1` 强制抓新帧。
- 服务端复用 1.2s 内的缓存帧，降低定位延迟。

### 实测

- 定位 411–576ms（1200×2608，缓存帧）。
- 断言成功 198ms；失败 1272ms（带诊断）。
- B 站真实任务：0 次试错、11 秒完成（v1.0 为 4 次试错、约 4 分钟）。

### 兼容

- 驱动仍为 `v1.0.0-rc`，无需重新发版；所有新能力经 `/api/*` 工作，a11y / root / gkd 三驱动通用。

## v1.0.0-rc (2026-11-25)

- 首个可交付版本：无障碍驱动（快照/截图/手势/文本/返回）、协议兼容、一键部署、auto 回退。
