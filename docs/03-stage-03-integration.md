# 03 · Stage S3 开发文档：集成与加固（能交付）

> 状态：已完成（含部分项，2026-11-25）　对应计划：[02-plan.md](02-plan.md) §5
> 版本：v1.0.0-rc　人日：实际约 4.6 / 计划 5

## 1. 阶段目标与范围

把驱动接进现有 `gkd-vision`，实现驱动回退与保活，完成集成测试与基础 soak，产出可交付版本。

覆盖：FR-10、FR-12、FR-13、FR-14；NFR 度量；闭环 ISSUE-001（部分）、ISSUE-018（部分）。

## 2. 实际完成内容

| 计划任务 | 状态 | 说明 |
| --- | --- | --- |
| S3-T1 a11y 接入 | ✅ | `--driver a11y`（127.0.0.1:8899），复用 GkdClient，客户端零改动 |
| S3-T2 回退链 | ✅ | `--driver auto`：a11y → root → gkd；实测两种命中 |
| S3-T3 保活 | ⚠️ 部分 | 应用内 watchdog（30s）重启 HTTP；`am force-stop` 后需重设无障碍服务 |
| S3-T4 非 root 引导 | ❌ 未做 | 需 Activity UI，转入 v1.1（ISSUE-004） |
| S3-T5 UI 联调 | ✅ | WS 帧 + 节点树、`/api/see` 落盘、镜像可用 |
| S3-T6 soak/兼容 | ⚠️ 部分 | 120s soak（fd 稳定、RSS 平稳）；仅 1 台设备 1 个 ROM |
| S3-T7 集成脚本 | ✅ | `tools/it.sh`（8 用例，含可选 `--soak`） |
| S3-T8 阶段文档 | ✅ | 本文 |
| S3-T9 发布检查 | ✅ | 安装/覆盖升级/卸载 + 部署幂等 |

## 3. 关键实现决策

| 决策 | 原因 |
| --- | --- |
| 协议补 `getSnapshots`/`deleteSnapshot` 空实现 | 客户端轮询链路会调用，避免 404 噪声 |
| `state` 暴露 `imeVisible` | 为「返回键是否会误触页面返回」提供判据（ISSUE-018） |
| watchdog 只负责 HTTP 重建 | 进程被 `force-stop` 时无障碍绑定本身已失效，需外部重设（部署脚本可重跑） |
| `auto` 探测顺序 a11y → root → gkd | 语义能力优先，其次帧率，最后兼容旧环境 |

## 4. 测试记录

**集成脚本 `tools/it.sh`（8/8 PASS）**：

```
PASS  state.status=ok
PASS  captureSnapshot nodes=428
PASS  getScreenshot 200
PASS  错误头
PASS  截图是 WebP
PASS  auto 启动成功（当前 a11y 可达）
PASS  deploy.sh 第二次执行通过
PASS  force-stop 后需重设服务才恢复（已恢复）
```

**回退链实测**：

```text
启动日志: [driver] auto → a11y (http://127.0.0.1:8899)
禁用无障碍后: [driver] auto → root
```

**Soak（120s，a11y 驱动持续抓帧）**：

| 指标 | 开始 | 结束 | 结论 |
| --- | --- | --- | --- |
| fd 数 | 134 | 134 | ✅ 无泄漏 |
| RSS | ~174.7MB | ~174.9MB | ✅ 平稳（但绝对值高，见 ISSUE-014） |
| 掉线 | — | 无 | ✅ |

**与 gkd-vision 联调**：

| 项 | 结果 |
| --- | --- |
| `/api/state` | `driver=a11y`，fps ≈ 0.8–0.9（interval 1.2s） |
| `/api/see?save=1` | 落盘 `frames/last.webp`，430 节点 |
| `/ws` | 帧 + 1Hz 树推送正常 |

## 5. 度量与目标

| 指标 | 目标 | 实测 | 判定 |
| --- | --- | --- | --- |
| NFR-03 稳定性（2h） | 2h 无掉线 | 2min soak 无掉线 | ⚠️ 时长不足 |
| NFR-04 兼容性 | 2 种 ROM | 1 种（HyperOS/Android 16） | ⚠️ 未覆盖 |
| NFR-06 RSS | <80MB | ~175MB | ❌ ISSUE-014 |
| NFR-07 单测 | ≥60% | 15 用例通过（未统计覆盖率） | ⚠️ 待补 |
| NFR-08 可观测 | 有状态接口 | `state` 含 version/fps/error/ime | ✅ |

## 6. 遗留问题（同步至 02 §6）

| ID | 描述 | 预期闭环 |
| --- | --- | --- |
| ISSUE-001 | 保活：进程被杀后无障碍需重设 | 部分闭环（watchdog）；v1.1 增加自启/重绑策略 |
| ISSUE-004 | 非 root 引导未实现 | v1.1 |
| ISSUE-013 | `activityId` 为空 | v1.1 |
| ISSUE-014 | RSS ~175MB | v1.1（位图/树缓存优化） |
| ISSUE-015 | 抓帧 390–690ms | v1.1（按需截图） |
| ISSUE-018 | `back` 与 IME 的交互 | 部分（暴露 imeVisible） |

## 7. 结论

`v1.0.0-rc` 具备「看 + 控 + 协议兼容 + 一键部署 + 回退」的完整闭环，可交付试用；
性能与兼容性指标尚未全部达标，已在 [05-integration-test.md](05-integration-test.md) 记录并转入 v1.1。
