# v1.2 · 02 开发计划（安全底座 + 门控诊断）

> 状态：**已锁定**（Stage 3 校验通过）　版本：v1.0　日期：2026-11-25
> 上游：[01-requirements.md](01-requirements.md)　口径：每阶段 5–7 人日

## 1. 总览

| 阶段 | 主题 | 覆盖 | 人日 | 里程碑 |
| --- | --- | --- | --- | --- |
| S1 | 安全底座 | FR-01/02/03/06/07 | 6 | `v1.2.0-alpha` |
| S2 | 门控诊断 | FR-04/05 | 5 | `v1.2.0-beta` |
| S3 | 集成 | 回归/复测/文档 | 5 | `v1.2.0` |
| 合计 | | | **16** | |

## 2. 前置

| 项 | 要求 |
| --- | --- |
| 驱动 | v1.0.0-rc 已安装、8899 可用 |
| 分支 | `feature/v1.2-security`（基于 main） |
| 设备 | KernelSU，Termux 可 `su` |

## 3. Stage S1：安全底座（6 人日）

| ID | 任务 | 人日 | 依赖 |
| --- | --- | --- | --- |
| S1-T1 | 驱动：token 生成（SecureRandom）、`files/vision.token`（0600）、请求校验、401 | 1.0 | — |
| S1-T2 | 驱动：`/api/capabilities` + `/api/ping`（免鉴权） | 0.5 | T1 |
| S1-T3 | 驱动：POST `Content-Type` 校验（400） | 0.3 | T1 |
| S1-T4 | Node：`GkdClient` 带 token、401 重读重试、`--token`/env | 0.8 | T1 |
| S1-T5 | 脚本：`tools/token.sh`、`deploy.sh`/`it.sh` 适配 | 0.6 | T4 |
| S1-T6 | 单测/契约测试（token 校验、capabilities 形状） | 0.6 | T1/T2 |
| S1-T7 | 真机验证：无 token 401、带 token 200、text/plain 400 | 0.7 | T5 |
| S1-T8 | 阶段文档 | 0.5 | 全部 |
| 缓冲 | | 1.0 | |

**验收**

```bash
curl -s -XPOST http://127.0.0.1:8899/api/state -o /dev/null -w '%{http_code}'      # 401
curl -s -XPOST http://127.0.0.1:8899/api/state -H "X-Vision-Token: $T" | jq .status # ok
```

## 4. Stage S2：门控诊断（5 人日）

| ID | 任务 | 人日 | 依赖 |
| --- | --- | --- | --- |
| S2-T1 | `src/gating.mjs`：阈值 + 系统包白名单 + 理由 | 0.8 | — |
| S2-T2 | `state`/`fingerprint` 增加 `gating` | 0.4 | T1 |
| S2-T3 | `/api/diagnose`（服务端汇总 + 建议） | 0.5 | T1 |
| S2-T4 | 兼容提示文案与文档（不自动改系统设置） | 0.5 | T3 |
| S2-T5 | 微信/B 站验证：门控 true/false | 0.8 | T2 |
| S2-T6 | 单测（阈值、白名单、误判样本） | 0.4 | T1 |
| S2-T7 | 阶段文档 | 0.5 | 全部 |
| 缓冲 | | 1.1 | |

## 5. Stage S3：集成（5 人日）

| ID | 任务 | 人日 | 依赖 |
| --- | --- | --- | --- |
| S3-T1 | 回归：`it.sh`、`ui-smoke`、`test-vision` | 0.6 | S1/S2 |
| S3-T2 | 安全用例：越权、非 JSON、token 轮换 | 0.8 | S1 |
| S3-T3 | 门控复测（微信开/关兼容） | 0.6 | S2 |
| S3-T4 | `05-integration-test.md` + CHANGELOG | 0.8 | 全部 |
| S3-T5 | 版本 `1.2.0`、合并 main | 0.4 | T4 |
| 缓冲 | | 1.8 | |

## 6. 测试用例目录

| ID | 内容 | 期望 |
| --- | --- | --- |
| TC-01 | 无 token 调 `/api/state` | 401，且不执行 |
| TC-02 | 带正确 token | 200 |
| TC-03 | 错误 token | 401 |
| TC-04 | `/api/capabilities` 字段完整 | version/actions/limits 等齐全 |
| TC-05 | `text/plain` POST | 400 `INVALID_CONTENT_TYPE` |
| TC-06 | 服务端遇 401 自动重读 token | 一次重试后成功 |
| TC-07 | 仅自研服务时微信 | `gating.gated=true` |
| TC-08 | 开兼容后微信 | `gated=false` |
| TC-09 | `/api/diagnose` | 返回 hint 且不自动改设置 |
| TC-10 | `it.sh` 回归 | 全绿 |
| TC-11 | `deploy.sh` 自检 | 自动取 token 并通过 |
| TC-12 | 边界：空 body/超大 body/非 JSON | 400，不崩溃 |

## 7. 追溯矩阵

| 需求 | 阶段 | 任务 | 测试 |
| --- | --- | --- | --- |
| FR-01 token | S1 | T1/T4 | TC-01/02/03/06 |
| FR-02 capabilities | S1 | T2 | TC-04 |
| FR-03 Content-Type | S1 | T3 | TC-05/12 |
| FR-04 门控诊断 | S2 | T1/T2 | TC-07/08 |
| FR-05 兼容提示 | S2 | T3/T4 | TC-09 |
| FR-06 服务端透传 | S1 | T4 | TC-06 |
| FR-07 脚本适配 | S1 | T5 | TC-10/11 |
| NFR-01 开销 | S1 | T1 | TC-02 |
| NFR-02 兼容 | S1 | T4 | TC-10 |
| NFR-03 恢复 | S1 | T4 | TC-06 |
| NFR-04 不回归 | S3 | T1 | TC-10 |

## 8. 附录：任务反向映射

| 任务 | 映射 |
| --- | --- |
| S1-T1 | FR-01、NFR-01 |
| S1-T2 | FR-02 |
| S1-T3 | FR-03 |
| S1-T4 | FR-01、FR-06、NFR-02/03 |
| S1-T5 | FR-07 |
| S1-T6 | FR-01/02/03 |
| S1-T7 | FR-01/02/03 真机 |
| S1-T8 | 流程 DoD |
| S2-T1 | FR-04 |
| S2-T2 | FR-04 |
| S2-T3 | FR-05 |
| S2-T4 | FR-05 |
| S2-T5 | FR-04 真机 |
| S2-T6 | FR-04 单测 |
| S2-T7 | 流程 DoD |
| S3-T1~T5 | 回归/发布 |

## 9. Stage 3 校验记录

| 检查线 | 结果 |
| --- | --- |
| 正向（需求→任务） | ✅ 7 条 FR 均有任务 |
| 反向（任务→需求） | ✅ 全部可映射 |
| 测试覆盖 | ✅ TC-01~12 均有期望 |
| 变更同步 | ✅ 00→01→02 一致 |

结论：锁定，进入 Stage 4。
