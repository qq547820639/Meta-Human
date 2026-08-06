# [生产就绪发布] Spec

## Why

代码与自动化测试已高度完备（pytest/vitest/tsc/cargo 全绿，多个既有 spec 已勾选完成），但当前产物**尚未达到可真实发布的生产状态**：`tauri.conf.json` 仍使用开发占位公钥与空 endpoints（fails-closed 但未生产化）；无真实 git tag 与 Release；Dev ID 签名/公证/notarization 未完成；全部真实 Provider 验收处于 `UNVERIFIED`；自然对话存在多套并行状态源；`useConversationController` 为超大编排 hook。本迭代把「功能完整的 Beta/RC 候选」深化为可真实发布、可诊断、可回滚的生产版本。

## What Changes

- 建立真实基线（commit SHA、CI 状态、全部门禁本地干净执行），输出「文档声明 vs 代码/CI 证据」差异清单。
- 修复全部 CI 门禁与供应链安全（Rust Clippy、cargo/uv/pnpm audit、Actions 固定版本、机器可读报告、连续两次干净 runner 一致）。
- 完成真实发布与更新闭环：生产更新公钥注入、stable/beta 通道、签名校验/下载校验/备份/迁移/回滚/拒绝安装/断点重试、macOS 签名+notarization+stapling、Universal DMG/SHA256SUMS/SBOM/provenance、真实 Release 与版本标签、版本一致性。
- 建立统一 Provider Contract Test Suite，覆盖本地/OpenAI-compatible/远程 GPU/飞书/STT/TTS/LLM/数字人，含 18 类故障场景；能力模型/健康评分/指数退避/熔断/自动恢复/降级原因/回退优先级/Privacy 模式远端封禁；结果标记 `REAL_VERIFIED | MOCK_VERIFIED | UNVERIFIED`。
- 统一自然对话生命周期：单一状态源、纯 selector 派生、事件携带 identity、过期事件拒绝、取消幂等、统一 cleanup、拆分 Coordinator、消除 `document.querySelector` 与不必要 eslint-disable。
- 将自然对话深化为可量化：端到端体验预算（P50/P95/P99）、SLO、按设备/provider/网络分组、自适应 VAD、轮次判断、低置信转写处理、回声/打断全场景、设备热插拔、权限撤销降级。
- 会话持久化与崩溃恢复：唯一 client_message_id/generation_id、幂等写入、崩溃点处理、重启后恢复状态、迁移前备份回滚、长会话分页虚拟化、故障注入。
- 深化知识库与长期记忆：离线评测集、Recall@K/MRR/引用准确率、原子索引切换、冲突展示、版本化引用；记忆字段完备、作用域分类、敏感默认禁存、用户管理、来源说明、级联清理。
- 隐私与安全加固：threat model、SSRF 防护、重定向防护、统一脱敏、secret leakage 测试、临时文件随机化、Keychain 密钥管理、SBOM/许可清单、签名验证测试。
- 优化首次使用与日常体验：能力自动检测、清晰模式、设备选择器与测试、进度体验、错误体验、可访问性、i18n 架构、性能基准与长会话资源。
- 补充测试矩阵：状态机模型测试、fuzz、弱网、Provider 超时限流、Sidecar 崩溃、迁移回滚、签名失败、热插拔、权限撤销、回声打断、长会话资源泄漏、多人物隔离、脱敏、幂等、StrictMode。
- 最终发布 `PRODUCTION_READINESS_REPORT.md`，含功能/Provider/指标/Security/Release 矩阵、UNVERIFIED 清单与是否允许发布的明确结论。

**BREAKING**：无。所有重构保持外部行为兼容，不删除现有功能，不降低质量门槛。

## Impact

- 受影响 spec：本迭代为全新 spec，不依赖既有 spec 的重新执行；复用其已勾选成果作为基线。
- 受影响代码：
  - `apps/desktop/src-tauri/`（tauri.conf.json、updater.rs、lib.rs、安全、签名注入）
  - `.github/workflows/ci.yml` 与 `scripts/`（发布/签名/公证/溯源/冒烟）
  - `apps/sidecar/src/voxstudio_core/`（providers、security、privacy、knowledge、memory、persistence）
  - `apps/desktop/src/features/conversation/`（状态机、Coordinator、控制器拆分、自然对话）
  - 前端 settings/readiness/update/diagnostics 面板
- 影响的外部条件：Apple 证书、update 签名公钥、真实 Provider 凭据、真实远端端点、干净 Mac —— 缺失项一律 `UNVERIFIED`，不得用 Mock 冒充。

## ADDED Requirements

### Requirement: 真实基线
系统 SHALL 在干净环境执行全部现有门禁并记录 commit SHA 与 CI 状态，输出文档声明与实际证据的差异清单。

#### Scenario: 基线审计
- **WHEN** 执行真实基线建立
- **THEN** 输出差异清单；不得删除测试/降覆盖率/关 lint/宽泛 ignore/skip audit/continue-on-error 制造全绿

### Requirement: 生产更新闭环（fails-closed）
系统 SHALL 以不可被运行时任意替换的方式注入生产更新公钥，禁止正式构建使用开发占位公钥；配置 stable/beta 真实 endpoint；实现版本检查→清单签名验证→下载校验→备份→安装→重启→迁移→回滚→签名错误拒绝→断点重试全链路。

#### Scenario: 签名错误拒绝安装
- **WHEN** 更新包签名校验失败
- **THEN** 拒绝安装，返回 `signature_invalid`，不执行任何安装动作

### Requirement: 统一 Provider 验收
系统 SHALL 提供统一 Provider Contract Test Suite，覆盖本地/OpenAI-compatible/远程 GPU/飞书/STT/TTS/LLM/数字人，每个 Provider 至少验证 18 类故障场景；结果严格标记 `REAL_VERIFIED | MOCK_VERIFIED | UNVERIFIED`。

#### Scenario: 无真实凭据
- **WHEN** 缺真实凭据
- **THEN** 测试仅证明协议兼容并标记 `MOCK_VERIFIED`；真实验收标记 `UNVERIFIED`，不得冒充 `REAL_VERIFIED`

### Requirement: 统一自然对话生命周期
系统 SHALL 以单一领域状态源驱动会话生命周期，`busy/speaking/canInterrupt/canSend/degraded/waitingForConfirmation` 等为纯 selector；所有异步事件携带 generation_id/conversation_id；过期事件被拒绝并记录原因；取消幂等（迟到 token 不写、迟到 TTS 不播、迟到数字人流不显示）。

### Requirement: 生产 Readiness 报告
系统 SHALL 在收口时生成 `PRODUCTION_READINESS_REPORT.md`，含 commit SHA、CI 链接与状态、功能/Provider/指标/Security/Release 矩阵、已知限制、UNVERIFIED 清单与是否允许发布的明确结论。

## MODIFIED Requirements

### Requirement: 现有 CI 质量门禁
在既有 `ci.yml`（sidecar/frontend/rust/security/release-gate）基础上，补齐机器可读报告、Actions 固定版本、Release Gate 强依赖保护、连续两次干净 runner 验证，保持不制造伪全绿。

### Requirement: 现有自然对话状态机
在既有 `naturalConversationStateMachine.ts` 基础上，深化为统一会话生命周期领域模型，消除多套并行状态源，并补充 SLO/指标分组/自适应 VAD/低置信转写等。

## REMOVED Requirements

### Requirement: 开发占位发布配置
**Reason**：`tauri.conf.json` 的 `VOXSTUDIO_DEVEL_PLACEHOLDER_INJECT_PRODUCTION_VIA_VOXSTUDIO_UPDATE_PUBKEY` 占位公钥与空 endpoints 不可用于正式构建。
**Migration**：生产公钥与 endpoint 通过环境注入并在正式构建中强制校验；缺失时 fails-closed 且不声称已发布。