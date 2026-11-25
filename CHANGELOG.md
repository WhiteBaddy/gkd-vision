## v1.2.0 (2026-11-25)

### 安全

- **驱动 HTTP 强制 token 鉴权**：首次启动生成 32 位令牌写入应用私有目录（0600），所有 `/api/*` 需 `X-Vision-Token`，否则 401；`/api/ping` 免鉴权。
- 非 `application/json` 的 POST 返回 400，阻断浏览器简单请求。
- 服务端自动读取令牌（`su cat`），401 时强制重读并重试一次；`tools/token.sh` 统一读取。

### 新增

- `POST /api/capabilities`：版本、动作、选择器属性、限制、能力位、端点清单。
- 门控诊断：`/api/state` 与 `/api/fingerprint` 增加 `gating`；`POST /api/diagnose` 给出兼容建议。
- 微信场景：兼容关闭 `gated=true`（1 节点），开启后 `gated=false`（376 节点）。

### 工具

- `tools/deploy.sh` 自动取令牌并通过鉴权健康检查；`tools/it.sh` 全量带令牌。
- 单测增至 21 条断言（指纹 9 / 匹配 6 / 门控 6）。

### CI

- 支持 `feature/**` 分支构建；加入阿里云 Maven 镜像规避 429。

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
