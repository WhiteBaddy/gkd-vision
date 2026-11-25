# v1.2 · 05 集成测试与总结

> 状态：完成　日期：2026-11-25　版本：`v1.2.0`
> 关联：[02-plan.md](02-plan.md)、[03-stage-03-integration.md](03-stage-03-integration.md)

## 1. 范围

- 驱动 HTTP 强制 token 鉴权，`/api/ping` 免鉴权；
- 能力发现 `/api/capabilities`；
- 非 JSON 请求拒绝；
- 门控诊断（`gating`）与 `/api/diagnose` 提示。

## 2. 测试矩阵

| ID | 内容 | 结果 |
| --- | --- | --- |
| TC-01 | 无 token → 401 | ✅ |
| TC-02 | 正确 token → 200 | ✅ |
| TC-03 | 错误 token → 401 | ✅ |
| TC-04 | capabilities 完整 | ✅ |
| TC-05 | `text/plain` → 400 | ✅ |
| TC-06 | 401 自动重读 | ✅ |
| TC-07 | 微信门控 `gated=true` | ✅ |
| TC-08 | 兼容开启后 `gated=false` | ✅ |
| TC-09 | `/api/diagnose` 提示 | ✅ |
| TC-10 | `it.sh` 回归 | ✅ 8/8 |
| TC-11 | `deploy.sh` 自检 | ✅ |
| TC-12 | 空/超大/非法 body | ✅ 不崩溃 |

统计：✅ 12 / ⚠️ 0 / ❌ 0。

## 3. 度量

| 指标 | 目标 | 实测 |
| --- | --- | --- |
| 鉴权开销 | <5ms | 字符串比较，实测不可测（<1ms） |
| 兼容性 | 三驱动 | a11y 实测；root/gkd 默认免 token |
| 恢复 | 401 重试一次 | token 轮换场景验证通过 |
| 回归 | 全绿 | npm check + it.sh |

## 4. 交付物

| 文件 | 说明 |
| --- | --- |
| `TokenStore.kt` / `VisionServer.kt` | 令牌生成、鉴权、capabilities、Content-Type |
| `src/gating.mjs` | 门控判定与提示 |
| `src/gkd.mjs` / `server.mjs` | token 透传、401 重试、`/api/diagnose` |
| `tools/token.sh` | 令牌读取 |
| `tools/deploy.sh` / `tools/it.sh` | 带 token 的健康检查与测试 |
| `tools/test-vision.mjs` | 21 条断言 |

## 5. 结论

- 本地控制接口从"任何应用可调用"收紧为"需令牌"；浏览器盲发路径被 400/401 双重拦截；
- 服务端能识别"树被门控"并给出兼容提示，微信场景 1→376 节点可复现；
- 功能与回归全部通过，可合并 main。

## 6. 遗留（转 v1.3）

ISSUE-039（手势事件特征实验）、ISSUE-040（packageNames 收窄）、ISSUE-041/042/043/045；以及 OCR、FileProvider、通知监听、事件流。
