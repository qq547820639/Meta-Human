# Deepen Production Iteration Spec

## Why
把 Meta-Human 从「功能较完整的工程纵切面」推进到「可真实发布、普通用户可自然对话、可长期可靠使用」的产品。当前 main（`31a7be2`）CI 已因 SSRF 策略与 mock smoke 冲突而变红，需先恢复并锁定全绿，再逐项完成真实发布闭环、真实验收、自然对话深化、首次使用简化与可信度加固。

## What Changes
- **P0 · 恢复并锁定全绿 CI**：修复当前 HEAD 的 mock-provider-smoke 失败（SSRF 正确拒绝 loopback，但 mock harness 需显式 opt-in），并为 SSRF 测试性 loopback 提供受控开关；补齐回归测试；配置分支保护建议。
- **P0 · 真实 macOS 发布闭环**：签名/公证/stapling/Gatekeeper/DMG/升级/回滚/卸载；无凭证时保留 dry-run 并标 UNVERIFIED；增加 provenance/SHA256/SBOM/签名验证/可重复构建证据。
- **P0 · 真实 Provider 验收**：本地/远程/飞书/STT/TTS/数字人在最新 commit 上重验；Mock 与真实分开报告；建立 CI 内受控真实 Provider smoke。
- **P1 · 自然语音对话深化**：VAD/端点检测/打断/回声/流式 STT+LLM/渐进 TTS/取消贯穿/设备切换/恢复；性能埋点与自动基准。
- **P1 · 数字人表现与降级**：统一状态机、音视频同步、打断即停、首帧/掉帧/卡死监测、分级降级、幂等远程资源。
- **P1 · 零配置首次使用**：自动检测、三预设模式、示例对话、分步引导、一键修复。
- **P1 · 知识/引用/记忆可信度**：引用预览/定位/过期/冲突/纠错；记忆候选确认、作用域、有效期、脱敏、遗忘、导出导入、级联清理；离线评测集。
- **P1 · 隐私/费用/数据流透明**：远程总开关、每 Provider 开关、数据流向提示、越界同意、费用预估、出境记录、密钥安全存储、诊断脱敏。
- **P1 · 可观测/离线/故障自愈**：correlation ID、日志滚动、Provider 指标、诊断页、一键脱敏 ZIP、一键修复；离线队列、退避、熔断、fallback、崩溃恢复、重复防护、备份恢复。
- **P2 · 无障碍/本地化/一致性**：VoiceOver、键盘、焦点、对比度、reduced motion、字幕、i18n（简中/英文）、设计系统。
- **测试矩阵**：Apple Silicon/Intel、安装/升级/降级/更新失败、断网、崩溃、设备切换、AirPods、长会话、多会话、分页、权限拒绝、迁移、磁盘满、睡眠唤醒。
- **交付物**：`docs/latest-production-audit.md`、分阶段计划、回归测试、性能基准、Provider 验收、发布 readiness、签名公证、干净机安装升级、诊断恢复、README/CHANGELOG、SHA256/provenance/SBOM、UNVERIFIED 清单。

## Impact
- Affected specs: `production-ready-release`（延续）、`deepening-real-verification`、`release-closure-natural-conversation`、`unified-provider-verify`
- Affected code: `apps/sidecar`（SSRF、providers、knowledge、main.py、scripts/smoke-mock-provider.py）、`apps/desktop`（Tauri updater、React 状态机、VAD、i18n）、`.github/workflows/ci.yml`、`scripts/`

## ADDED Requirements
### Requirement: SSRF 测试性 loopback opt-in
系统 SHALL 提供显式环境变量开关，使 mock 测试 harness 可将远程/飞书 Provider 指向 loopback，而生产默认仍拒绝 loopback。
#### Scenario: CI mock smoke 通过
- **WHEN** mock smoke 设置 `VOXSTUDIO_ALLOW_LOOPBACK_PROVIDERS=1`
- **THEN** RemoteGpuConfig/FeishuClient 允许 loopback base_url，smoke 通过；未设置时仍拒绝。

### Requirement: 生产发布闭环
系统 SHALL 在具备 Apple 凭证时完成签名/公证/stapling；缺凭证时如实标 UNVERIFIED 且不误报成功。
#### Scenario: 无凭证环境
- **WHEN** 未配置 Developer ID / notary 凭证
- **THEN** 产物为未签名并明确标记 UNVERIFIED，输出所需 secret 名与人工步骤。

### Requirement: 真实 Provider 验收报告
系统 SHALL 在最新 commit 上按 `REAL_VERIFIED | MOCK_VERIFIED | UNVERIFIED` 重验 Provider。
#### Scenario: 缺凭证
- **WHEN** 本地/远程/飞书无可用服务或凭证
- **THEN** 对应项标 UNVERIFIED，Mock 契约测试单独报告，不降级为 PASS。

## MODIFIED Requirements
### Requirement: CI 全绿
在 `production-ready-release` 基础上，当前 commit 所有强制 job 复绿，Release gate 实际执行并通过。
### Requirement: 统一脱敏
扩展 `sanitize.py` 覆盖诊断包、隐私设置、keychain 相关路径。

## REMOVED Requirements
无移除；保留既有功能与架构。