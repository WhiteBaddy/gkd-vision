# v1.1 · 01 需求分析与功能分析（P0）

> 状态：**已锁定**（Stage 3 校验通过）
> 版本：v0.2　日期：2026-11-25
> 上游：[00-feasibility.md](00-feasibility.md)
> 依据：[../../DEVELOPMENT-GUIDELINES.md](../../DEVELOPMENT-GUIDELINES.md)（解耦 / 傻瓜 / 全面）

## 0. 设计原则与本迭代的落地

| 原则 | 本迭代落地 |
| --- | --- |
| 解耦 | 全部能力放**服务端**，只依赖驱动 `/api/*`；驱动无需改代码即可获得指纹/断言/视觉定位 |
| 傻瓜 | `act` 一步完成「动作 + 断言」，失败自动带诊断；`tapText`/`tapImage` 一条调用 |
| 全面 | 三种驱动（a11y/root/gkd）通用；断言支持文本与图像两条路 |

## 1. 术语

| 术语 | 含义 |
| --- | --- |
| 指纹（fingerprint） | 当前页面的可判定身份：包名 + 关键文本哈希 + 窗口/输入法状态 |
| 断言（assert） | 动作后期望出现的状态，轮询直至超时 |
| 模板（template） | 一张小图（通常是截图裁剪），用于在屏幕上定位 |
| 粗到细匹配 | 低分辨率找候选 → 原分辨率小窗口精修 |

## 2. RC → FR 映射

| RC | 承接 |
| --- | --- |
| RC-01 指纹 | FR-01 |
| RC-02 断言 | FR-02 |
| RC-03 模板定位 | FR-03 |
| RC-04 按文本点击 | FR-04 |
| RC-07 诊断 | FR-05 |
| RC-05/06/08 | FR-06（状态暴露）/ 延后 |

## 3. 功能需求

### FR-01 页面指纹 `P0`

- `POST /api/fingerprint`（或 `/api/state` 内联）返回：
  `{ package, activity, title, keyTexts[], textHash, nodeCount, imeVisible, isPip }`。
- 关键文本取面积最大的前 5 个非空文本，`textHash = sha1(package + keyTexts)`。
- 验收：同一页面连续 5 次抓取哈希一致；切到另一应用后哈希变化。

### FR-02 动作断言 `P0`

- `POST /api/act`：`{ payload: <execSelector 负载>, expect: { text?, textGone?, fingerprintChange?, imageDiff? }, timeoutMs }`。
- 执行动作 → 轮询 `captureSnapshot`：
  - `text`：树中出现该文本；
  - `textGone`：文本消失；
  - `fingerprintChange`：指纹与动作前不同；
  - `imageDiff`：与动作前截图差异比例 > 阈值（用 `magick compare`）。
- 返回 `{ ok, verified, elapsedMs, fingerprintBefore, fingerprintAfter, attempts }`。
- 验收：点击「评论」后 `expect.text="最新评论"` 能在 1.5s 内判定成功；点击无效位置时返回 `verified=false`。

### FR-03 模板定位 `P0`

- `POST /api/find`：`{ templateBase64 | region:{x,y,w,h}, threshold?, scale? }`。
- 返回 `{ found, x, y, score, candidates[], width, height, elapsedMs }`。
- 算法：截图 → 灰度 raw（25%）→ 粗搜索（1/4 降采样）→ 精修（±6px）。
- 验收：在一张 1200×2608 截图上定位 100×40 模板，**≤800ms**，误差 ≤3px；不存在的模板返回 `found=false`。

### FR-04 便捷动作 `P1`

- `POST /api/tapText { text, exact? }`：`[text="…"]` 选择器点击（失败回退为「找节点中心 + 坐标点击」）。
- `POST /api/tapImage { template… }`：定位 + 点击 + 可选断言。
- 验收：B 站首页点击卡片标题走 `tapText` 成功，不依赖截图坐标。

### FR-05 诊断信息 `P0`

- 失败响应体统一带：`error.code`、`error.message`、`fingerprint`、`lastFrameSeq`，可选 `screenshotBase64`。
- 验收：断言超时时能直接看到「当前在哪个应用/页面」。

### FR-06 状态暴露 `P1`

- `/api/state` 增加 `fingerprint`、`windows`（数量与类型）、`imeVisible`（已有）。
- 验收：微信选择器打开时 `imeVisible=false`、`windows>1` 可见。

## 4. 非功能需求

| ID | 需求 | 指标 |
| --- | --- | --- |
| NFR-01 | 指纹耗时 | ≤700ms（复用一次抓帧） |
| NFR-02 | 定位耗时 | ≤800ms（1200×2608，模板 ≤300×120） |
| NFR-03 | 定位准确率 | 测试集 ≥95%，误报 <5% |
| NFR-04 | 断言超时默认 | 1500ms，可配 |
| NFR-05 | 兼容 | a11y / root / gkd 三驱动均可调用 |
| NFR-06 | 不回归 | v1.0 的 `/api/*` 行为不变，`it.sh` 全绿 |

## 5. 用例

### UC-01 微信发图（复测）

1. `fingerprint` 确认 `package=com.tencent.mm`；
2. `tapText("相册")`（失败则 `tapImage` 用模板）；
3. `act(expect.text="预览")` 确认进入选择器；
4. `tapImage(测试图缩略图)` → `act(expect.text="发送")`；
5. 点击发送 → `act(expect.text="GKD-VISION")` 验证气泡出现。

### UC-02 B 站读评论（复测）

1. `fingerprint` 确认 `package=tv.danmaku.bili`（而非 `com.bilibili.app.in`）；
2. `tapText("评论")` → `act(expect.text="热门评论")`；
3. `tapText("按热度")` → `act(expect.text="最新评论")`；
4. 读取首条评论文本（现有能力）。

### UC-03 误点保护

- 动作前校验指纹不匹配 → 直接返回 `PAGE_MISMATCH`，不执行动作。

## 6. 难点分析

| ID | 难点 | 影响 | 对策 | 验证 |
| --- | --- | --- | --- | --- |
| VD-01 | 模板缩放/密度差异 | 定位偏移 | 匹配前统一缩放到屏幕宽 25%，模板同比缩放 | 三种尺寸模板 |
| VD-02 | 纯色/小模板误报 | 点错位置 | 阈值 + top3 候选 + 最小尺寸限制 | 负样本测试 |
| VD-03 | 动画导致断言误判 | 超时 | 轮询 + 文本优先 + 图像差分兜底 | 评论面板动画 |
| VD-04 | 指纹受时间/数字影响 | 哈希漂移 | 关键文本过滤纯数字与时间 | 连续抓取测试 |
| VD-05 | 微信无 a11y | 只能视觉 | 模板 + 差分 | UC-01 |

## 7. 需求锁定

| 范围 | 条目 |
| --- | --- |
| v1.1.0（P0） | FR-01、FR-02、FR-03、FR-05 |
| v1.1.1（P1） | FR-04、FR-06 |
| 不做 | OCR、遮挡自动关闭、任务 DSL |

## 8. 技术栈与 ADR

| 层 | 选型 | 理由 |
| --- | --- | --- |
| 视觉解码 | ImageMagick `magick … gray:-` | 已在设备上，~200ms |
| 匹配 | 纯 JS 灰度 SSD，粗到细 | 无依赖；实测小样本 13ms |
| 断言 | 轮询 `captureSnapshot` | 复用现有驱动接口 |
| 图像差分 | `magick compare -metric AE` | 现成 |

- **ADR-01｜视觉逻辑放服务端**：驱动只提供帧与节点，避免三次发版；代价是每次定位多一次截图传输（本地回环可接受）。
- **ADR-02｜指纹用「包名 + 关键文本 sha1」**：简单、稳定；不依赖 activityId（当前为空）。
- **ADR-03｜断言优先文本、图像差分兜底**：文本断言快且语义准；无 a11y 时用差分。
- **ADR-04｜不做 OCR**：tesseract 未安装、体积大；v1.1 用模板匹配覆盖「找按钮/图标」，文本仍靠 a11y。

## 9. 接口契约

```text
POST /api/fingerprint  {} → { package, activity, title, keyTexts, textHash, nodeCount, imeVisible }
POST /api/find         { templateBase64 | region, threshold? } → { found, x, y, score, candidates }
POST /api/act          { payload, expect?, timeoutMs? } → { ok, verified, elapsedMs, fingerprintBefore, fingerprintAfter }
POST /api/tapText      { text, exact? } → { ok, point, selector }
POST /api/tapImage     { templateBase64 | region, expect? } → { ok, point, score }
错误码新增：PAGE_MISMATCH、TEMPLATE_NOT_FOUND、ASSERT_TIMEOUT、TEMPLATE_INVALID
```

## 10. 验收标准（v1.1.0 DoD）

- [ ] FR-01/02/03/05 全通过，单测 + 真机用例
- [ ] NFR-01~04 达标（记录实测）
- [ ] `tools/it.sh` 全绿（无回归）
- [ ] 微信发图、B 站读评论两次复测：错误尝试 ≤1 次

## 11. 初始遗留问题

| ID | 描述 | 预期闭环 |
| --- | --- | --- |
| ISSUE-023 | 模板匹配对动态背景（视频）误报率未知 | v1.1 测试后评估 |
| ISSUE-024 | 指纹未包含窗口类型（需驱动补 windows） | v1.2 |
| ISSUE-025 | 无 OCR，纯图标按钮只能靠模板 | v1.2 |
