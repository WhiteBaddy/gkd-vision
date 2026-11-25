# v1.2 · 03 阶段 S3 文档：集成

> 状态：完成（2026-11-25）　对应计划：[02-plan.md](02-plan.md) §5
> 人日：实际约 3.0 / 计划 5

## 1. 回归

```text
npm run check   → ui-smoke + 21 条断言（指纹 9 / 匹配 6 / 门控 6）
tools/it.sh     → PASS=8 FAIL=0（全部带 token）
deploy.sh       → 自动取 token，健康检查通过
```

## 2. 安全用例

| 用例 | 结果 |
| --- | --- |
| 无 token 调动作端点 | 401，未执行 |
| 错误 token | 401 |
| 非 JSON Content-Type | 400 |
| token 轮换后恢复 | 自动重读成功 |
| 2MB body | 截断解析失败，不崩溃 |

## 3. 门控用例

| 场景 | 结果 |
| --- | --- |
| 微信（兼容关） | `gated=true` + hint |
| 微信（兼容开） | `gated=false`，376 节点 |
| B 站 | `gated=false` |

## 4. 与目标对比

| 目标 | 结果 |
| --- | --- |
| 本地接口不再对任意应用开放 | ✅ 无 token 一律 401 |
| 服务端能识别树被门控 | ✅ `gating` + `diagnose` |
| 不回归 v1.0/v1.1 能力 | ✅ it.sh 8/8、npm check 全绿 |
| 兼容开关不自动改系统设置 | ✅ 仅提示 |

## 5. 遗留

| ID | 描述 |
| --- | --- |
| ISSUE-041 | 业务错误与鉴权错误的 HTTP 风格不统一 |
| ISSUE-042 | 无 token 轮换 API |
| ISSUE-043 | 白屏可能误报门控 |
| ISSUE-045 | 脚本/第三方调用需带 token，文档需同步 |
