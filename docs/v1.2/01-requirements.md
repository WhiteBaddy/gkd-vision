# v1.2 · 01 需求分析（安全底座 + 门控诊断）

> 状态：**已锁定**（Stage 3 通过）　日期：2026-11-25　上游：[00-feasibility.md](00-feasibility.md)

## 1. 设计原则落地

| 原则 | 落地 |
| --- | --- |
| 安全 | 默认鉴权；最小暴露；拒绝非 JSON |
| 解耦 | 鉴权与诊断都在驱动/服务端契约层，不影响动作语义 |
| 傻瓜 | 部署脚本自动拉 token；401 自动恢复 |
| 全面 | 三驱动通用：root/gkd 驱动不需要 token，服务端按驱动类型决定 |

## 2. 功能需求

### FR-01 驱动 token 鉴权（P0）

- 服务启动时若无 `files/vision.token`，用 `SecureRandom` 生成 32 位十六进制，写入并 `chmod 600`；
- 所有 `/api/*` 请求必须带 `X-Vision-Token`，不匹配返回 **401** + `GKD-RPC-Status: error`；
- `/api/ping` 免鉴权（仅返回 `{"ok":true}`，用于部署探测存活，不泄露任何界面信息）。

### FR-02 能力发现（P0）

- `POST /api/capabilities`（需 token）返回：版本、tokenRequired、actions、selectorProps、limits、系统能力位、端点列表。

### FR-03 请求格式校验（P1）

- POST 的 `Content-Type` 非 `application/json` → 400 `INVALID_CONTENT_TYPE`（阻止浏览器简单请求）。

### FR-04 门控诊断（P0）

- 规则：`nodeCount ≤ 2` 且包名不在系统白名单（`android`、`com.android.systemui` 等）→ `gated=true`；
- `GET /api/state` 与 `/api/fingerprint` 增加 `gating: { gated, reason, nodeCount }`；
- 仅作提示，不改变抓取行为。

### FR-05 兼容模式提示（P1）

- 服务端 `/api/diagnose` 汇总：`gated`、`package`、建议动作（`a11y-compat.sh on`）；
- 不自动改系统设置。

### FR-06 服务端 token 透传（P0）

- 启动时按 `--token` → `VISION_TOKEN` → `su cat` 顺序获取；
- `GkdClient` 每个请求带 header；401 时重读 token 重试一次，仍失败则报 `UNAUTHORIZED`。

### FR-07 脚本适配（P0）

- `deploy.sh`、`it.sh` 从 `su cat` 读 token 并带 header；
- 提供 `tools/token.sh` 统一输出 token（供其它脚本引用）。

## 3. 非功能需求

| ID | 需求 | 指标 |
| --- | --- | --- |
| NFR-01 | 鉴权开销 | 单请求 <5ms |
| NFR-02 | 兼容性 | root/gkd 驱动不受影响；mock 默认免鉴权 |
| NFR-03 | 可恢复 | token 变化后服务端自动重读，最多重试 1 次 |
| NFR-04 | 不回归 | `it.sh` 全绿，v1.1 的 6 个新端点行为不变 |

## 4. 用例

- **UC-01 正常调用**：Termux 带 token → 200；
- **UC-02 未鉴权**：其它应用无 token → 401，且不执行任何动作；
- **UC-03 部署自检**：`deploy.sh` 安装后自动取 token 并健康检查；
- **UC-04 门控诊断**：仅自研服务时微信 → `gated=true`；开启兼容后 → `gated=false`。

## 5. 难点

| ID | 难点 | 对策 |
| --- | --- | --- |
| VD-01 | token 在应用私有目录，Termux 需 root 读取 | 已验证 root 可读；无 root 时提示用户手动填 `--token` |
| VD-02 | 门控阈值误判 | 结合包名 + `nodeCount`，只提示不阻断 |
| VD-03 | 旧脚本/第三方调用失效 | 明确 401 错误码与文档迁移说明 |

## 6. 接口契约

```text
POST /api/ping          （免鉴权） → { ok }
POST /api/capabilities  （鉴权）   → { name, version, tokenRequired, actions[], selectorProps[], limits{}, capabilities{}, endpoints[] }
POST /api/state         （鉴权）   → 增加 gating { gated, reason, nodeCount }
POST /api/fingerprint   （鉴权）   → 增加 gating
GET  /api/diagnose      （服务端） → { gated, package, hint }
401 → { error: "unauthorized", code: "UNAUTHORIZED" }
400 → { error: "...", code: "INVALID_CONTENT_TYPE" }
```

## 7. 验收（DoD）

- [ ] 无 token 调用 `/api/state` → 401，且动作类端点不执行
- [ ] 带 token 正常；`capabilities` 字段完整
- [ ] 浏览器式 `text/plain` POST → 400
- [ ] 微信门控时 `gated=true`，兼容开启后 `gated=false`
- [ ] `it.sh`、`deploy.sh`、`npm run check` 全绿
- [ ] 文档与 CHANGELOG 更新
