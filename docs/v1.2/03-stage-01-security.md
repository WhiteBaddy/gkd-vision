# v1.2 · 03 阶段 S1 文档：安全底座

> 状态：完成（2026-11-25）　对应计划：[02-plan.md](02-plan.md) §3
> 人日：实际约 5.2 / 计划 6

## 1. 完成内容

| 任务 | 状态 | 说明 |
| --- | --- | --- |
| S1-T1 token 鉴权 | ✅ | 首次启动生成 32 位十六进制，写 `files/vision.token`（0600）；`/api/*` 校验 `X-Vision-Token` |
| S1-T2 能力发现 | ✅ | `POST /api/capabilities`（10 个动作、6 个选择器属性、限制、能力位、端点）；`/api/ping` 免鉴权 |
| S1-T3 Content-Type 校验 | ✅ | 非空 body 且非 `application/json` → 400 |
| S1-T4 Node 透传 | ✅ | `GkdClient` 带 token；401 强制重读并重试一次 |
| S1-T5 脚本适配 | ✅ | `tools/token.sh`；`deploy.sh` 自动取 token；`it.sh` 统一带 header |
| S1-T6 单测 | ✅ | capabilities/门控等 21 条断言 |
| S1-T7 真机 | ✅ | 见 §3 |
| S1-T8 文档 | ✅ | 本文 |

## 2. 关键决策

- **令牌放应用私有目录**：其它应用读不到，Termux 用 root 读；不硬编码、不进日志；
- **401 用 HTTP 状态码**（区别于业务错误的 `GKD-RPC-Status`），让客户端能识别并重试；
- **`/api/ping` 免鉴权**：只回 `{"ok":true}`，供部署探测存活且不泄露界面信息；
- **Content-Type 校验只对非空 body**：空 body 的 `POST /api/state` 仍可用。

## 3. 真机测试

| 用例 | 结果 |
| --- | --- |
| 无 token 调 `/api/state` | **401** |
| 错误 token | **401** |
| 正确 token | **200**（`status=ok`, `version=1.2.0`） |
| 无 token 调 `/api/execSelector`（点击） | **401，且未执行任何动作** |
| `/api/ping` 无 token | `{"ok":true}` |
| `/api/capabilities` | version/tokenRequired/actions(10)/selectorProps(6)/limits/capabilities 齐全 |
| `text/plain` POST | **400 `INVALID_CONTENT_TYPE`** |
| 非 JSON body（json 头） | `INVALID_ARGUMENT`（协议错误头） |
| 2MB body | 截断到 1MB 后解析失败，不崩溃 |
| token 轮换 | 写错 token 后请求失败；恢复文件后**下一次请求自动重读并成功** |
| `deploy.sh` | 自动取 token，健康检查通过（`token auth on`） |
| `it.sh` | 8/8 PASS |

## 4. 遗留

| ID | 描述 | 闭环 |
| --- | --- | --- |
| ISSUE-041 | 业务错误仍返回 HTTP 200 + `GKD-RPC-Status`（协议兼容），与 401/400 风格不一致 | v1.3 统一评估 |
| ISSUE-042 | token 未支持轮换 API | v1.3 |
