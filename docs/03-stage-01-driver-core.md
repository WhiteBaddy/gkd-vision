# 03 · Stage S1 开发文档：驱动核心（能看）

> 状态：已完成（2026-11-25）　对应计划：[02-plan.md](02-plan.md) §3
> 版本：v0.1.0-alpha　人日：实际约 5.8 / 计划 6

## 1. 阶段目标与范围

目标：在真机上通过本地 HTTP 拿到**完整快照（控件树 + 元信息）**与**WebP 截图**，并有可复现的 APK 构建与最小验证手段。

覆盖：FR-01、FR-02、FR-08（部分）；NFR-01 初测。

## 2. 实际完成内容

| 计划任务 | 状态 | 说明 |
| --- | --- | --- |
| S1-T1 工程骨架 | ✅ | `driver-core`(AAR) + `driver-app`(APK)，Gradle 8.7 / AGP 8.5.2 / Kotlin 2.0.21 |
| S1-T2 A11yService | ✅ | 服务声明、前台包名/类名跟踪、连接后启动 HTTP |
| S1-T3 快照遍历 | ✅ | DFS 扁平化，节点上限 4096 / 深度 64 / 单节点子数 512 |
| S1-T4 JSON 序列化 | ✅ | 字段对齐 GKD `ComplexSnapshot`，`org.json` 零依赖 |
| S1-T5 截图 | ✅ | `takeScreenshot` → WebP q70；失败返回 `SCREENSHOT_FAILED` |
| S1-T6 最小 HTTP | ✅ | `/api/state`、`/api/getServerInfo`、`/api/captureSnapshot`、`/api/getScreenshot`，仅 127.0.0.1:8899 |
| S1-T7 CI | ✅ | GitHub Actions 出包 + 滚动 release `ci-latest` + 失败日志 `build.log` |
| S1-T8 冒烟脚本 | ⚠️ 部分 | 以命令清单形式落地（见 §4），未封装为脚本 |
| S1-T9 oracle 基线 | ⚠️ 部分 | `tools/oracle-diff.sh` 已写，GKD 未开启故未执行（ISSUE-016） |
| S1-T10 单元测试 | ✅ | 7 个 JVM 用例（快照遍历 5 + JSON 2） |
| S1-T11 阶段文档 | ✅ | 本文 |

## 3. 关键实现决策

| 决策 | 原因 |
| --- | --- |
| 端口改为 **8899** | 与 GKD 的 8888 并存，便于开发期 oracle 并行对比 |
| 快照与截图同时产出 | 对齐 GKD 语义（`captureSnapshot` 后可用 `getScreenshot(id)`） |
| 截图缓存 LRU=4 | 避免把整屏位图长期驻留内存 |
| 提交固定 PKCS12 开发签名 | 每次 CI 重新生成 debug keystore 会导致无法覆盖安装 |
| 单元测试用 `org.json` Maven 包 | Android 的 `org.json` 在 JVM 单测里是 stub，同 API 的 jar 可离线测试 |
| 节点遍历抽象为 `NodeSource` | 树遍历逻辑可脱离 Android 单测 |

## 4. 测试记录

**单元测试**（CI `testDebugUnitTest`）：7/7 通过。

```
SnapshotBuilderTest: 扁平化 id/pid/depth、vid 派生、节点/子数/深度上限
SnapshotJsonTest: 顶层字段、null text、节点宽度与文本
```

**真机冒烟**（Redmi 25102RKBEC / Android 16 / KernelSU）：

```bash
su -c "settings put secure enabled_accessibility_services dev.everything.vision/dev.everything.vision.A11yService"
su -c "settings put secure accessibility_enabled 1"
curl -s -XPOST http://127.0.0.1:8899/api/state          # {"status":"ok",...}
curl -s -XPOST http://127.0.0.1:8899/api/captureSnapshot -o snap.json
curl -s -XPOST http://127.0.0.1:8899/api/getScreenshot -d '{"id":1}' -o shot.webp
```

| 项 | 结果 |
| --- | --- |
| `/api/state` | `status=ok`，`lastError=null` |
| 快照节点数 | 1159 ~ 1171（浏览器 + 聊天页） |
| 文本节点 | 805 |
| 截图 | 1200×2608 WebP，121–128KB |
| 抓帧耗时 | 0.39s（预热后）、0.69s（首次） |
| JSON 体积 | ~373KB |
| 进程 RSS | 179MB |
| 错误路径 | 不存在的 id 返回 `GKD-RPC-Status: error` |

## 5. 度量与目标对照

| 指标 | 目标（01/02） | 实测 | 判定 |
| --- | --- | --- | --- |
| NFR-01 快照 p95 | ≤250ms | 390–690ms | ❌ ISSUE-015 |
| NFR-06 RSS | <80MB | 179MB | ❌ ISSUE-014 |
| FR-02 截图体积 | ≤350KB | 121–128KB | ✅ |
| FR-01 节点上限 | 4096 | 未触发 | ✅ |

## 6. 遗留问题（同步至 02 §6）

| ID | 描述 | 预期闭环 |
| --- | --- | --- |
| ISSUE-013 | `activityId` 为空（仅依赖 `TYPE_WINDOW_STATE_CHANGED`，服务重启后无事件） | S2（补窗口信息/事件缓存） |
| ISSUE-014 | RSS 179MB 超 NFR-06 目标 | S3（优化 + 修订指标口径） |
| ISSUE-015 | 抓帧 390–690ms，未达 NFR-01 250ms | S2（截图按需）+ S3 |
| ISSUE-016 | oracle 对比脚本未执行（GKD 未开启） | 开发期随时（需开 GKD HTTP） |

## 7. 下一阶段输入

- 协议端点已就绪，S2 只需补 `execSelector` 与错误码；
- 端口 8899 固定，S2 的 `deploy.sh` 与 S3 的服务端接入都按此配置；
- 快照结构稳定，S2 的 selector-lite 可直接消费 `nodes[].attr`。
