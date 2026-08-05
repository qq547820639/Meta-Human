# 正式发布闭环 + 自然对话体验深化 Spec

## Why

基线（`main` @ `39057bdd`）在 `production-convergence` 迭代后代码与自动化测试完整，但存在关键缺口：

1. `scripts/smoke-providers.sh` 的本地 provider 检查存在**假阳性**：ClashX 代理把 `127.0.0.1:11434` 的请求回 502、curl 以 exit 0 收尾，脚本误报 `OK`。
2. 真实 provider 验收 13 项全部「未验证」；当前 DMG 为 ad-hoc 签名、`spctl` 拒绝，未完成 Developer ID 签名 / 公证 / 安装闭环。
3. 语音交互仍是「点击录音 + 回合制」，缺少自然对话（VAD / 打断 / 打断取消 / 弱网降级）能力。
4. 首次使用门槛、知识/记忆体验、可观测性与无障碍仍有明确提升空间。

本次迭代把版本从「集成完整、可验证」推进到「可发布、可自然对话、可交付真实验收结果」的状态。

## What Changes

- **P0-修复 provider 假阳性**：重写 `scripts/smoke-providers.sh`，绕过代理、仅接受 2xx、校验 JSON、区分失败类型、结构化 PASS/FAIL/UNVERIFIED、无真实可用 provider 时非零退出；补自动化测试。
- **P0-真实 provider 验收体系**：新增可选的真实集成测试（本地 OpenAI-compatible / 远程 GPU / 飞书 / 生命周期），缺凭证标 UNVERIFIED；结果写入机器可读 JSON + 人类可读 Markdown。
- **P0-正式发布闭环**：Developer ID 签名、notarization、stapling、Gatekeeper、arm64+x86_64、干净安装、断网启动、覆盖升级、卸载清理、崩溃清理；安全签名应用更新机制。
- **P1-自然对话**：`idle → listening → transcribing → thinking → speaking → interrupted/reconnecting/error` 状态机；VAD、分块 STT 临时转写、打断取消真实 generation_id、回声消除/降噪/AGC、数字人说话时降麦克风、按键/自然对话切换、性能预算记录。
- **P1-数字人呈现**：视频流/TTS/generation 统一生命周期；stream loading/buffering/reconnecting/fallback 状态；失败保留文字与音频；静态人像自然降级；provider 能力时音画同步/口型/情绪；页面隐藏/休眠/网络切换恢复。
- **P1-首次使用门槛**：配置向导、本地服务自动探测、模型下拉、能力-模型匹配校验、技术错误翻译为用户可操作步骤、本地/远程数据范围说明、保存前校验+保存后真实验证、高级端点折叠。
- **P1-知识/记忆**：增量同步与进度、新鲜度与失败原因、单文档启停/重同步/删除、引用展示、无依据回答标记、检索质量测试集；长期记忆来源/时间、固定/编辑/删除/禁用、显式 vs 系统记忆、作用域、注入前检查、隐私说明与彻底删除验证。
- **P1-可靠/可观测/无障碍**：结构化日志与 request_id 全链路、脱敏诊断包、provider 延迟/错误率/取消率/降级率、崩溃/迁移/媒体泄漏测试、性能测试、键盘完整操作、VoiceOver、字幕、reduced motion、高对比度/字体缩放、全状态 UI 测试；遥测默认尊重隐私。
- **BREAKING**：`smoke-providers.sh` 的退出码语义与输出格式变化（无真实 provider 时非零退出；结构化输出）。

## Impact

- Affected specs：`production-convergence`（本迭代在其基础上深化，不删除其产物）。
- Affected code：`scripts/smoke-providers.sh`、`apps/desktop/src/`（语音/数字人呈现/设置/知识/记忆/可观测）、`apps/sidecar/src/`（真实 provider 适配器、日志、验证入口）、`docs/`、`.github/workflows/`。
- Affected docs：`docs/real-provider-acceptance.md`、`docs/release-checklists.md`、`docs/release-experience.md`、`docs/development.md`、`README.md`、`output/*`。

## ADDED Requirements

### Requirement: Provider 检查无假阳性
系统 SHALL 在本地 provider 检查中绕过系统代理与 `*_PROXY` 环境变量，仅接受 HTTP 2xx，并校验响应为符合预期的 JSON。

#### Scenario: 代理返回 502 但 curl 进程退出码为 0
- **WHEN** 本地模型服务不存在，但系统代理拦截并对 `127.0.0.1:11434` 返回 502
- **THEN** provider 检查报 FAIL（非 OK），且整体无真实可用 provider 时脚本非零退出

#### Scenario: 合法 provider 响应
- **WHEN** `127.0.0.1:11434/api/tags` 返回 200 且为合法 JSON
- **THEN** 本地 provider 报 PASS，脚本输出结构化结果

### Requirement: 真实 provider 验收体系
系统 SHALL 提供可选的真实集成测试，覆盖本地 OpenAI-compatible、远程 GPU、飞书与生命周期；缺凭证时标 UNVERIFIED，不得标 PASS。结果 SHALL 写入机器可读 JSON 与人类可读 Markdown，记录时间/版本/commit/架构。

#### Scenario: 缺少凭证
- **WHEN** 远程 GPU / 飞书 / Apple 凭证未设置
- **THEN** 对应验收项输出 UNVERIFIED，并列出缺失凭证

### Requirement: 自然对话状态机
语音交互 SHALL 由真实事件驱动（非固定 `setTimeout`），实现 `idle → listening → transcribing → thinking → speaking → interrupted/reconnecting/error` 的合法状态转换。

#### Scenario: 用户打断数字人
- **WHEN** 数字人正在 `speaking`，用户开始说话
- **THEN** 系统取消对应 `generation_id` 的 LLM 生成、停止 TTS/音频播放与 avatar 后续动作，且被取消任务不写入消息也不自动播放

### Requirement: 安全签名应用更新
系统 SHALL 提供带签名验证的应用更新机制（更新检查/下载进度/签名验证/失败恢复/迁移前备份/回滚策略）。

## MODIFIED Requirements

### Requirement: 实时 provider 验收（原 `docs/real-provider-acceptance.md` runbook）
将 runbook 从「仅有步骤」升级为「可执行脚本 + 缺凭证 UNVERIFIED + 机器可读证据」。

### Requirement: 发布待办（原 `docs/release-checklists.md`）
将 Developer ID 签名、公证、stapling、干净安装、权限流程、断网启动、覆盖升级、卸载清理、崩溃清理纳入可执行验收清单。

## REMOVED Requirements

### Requirement: 旧 `scripts/smoke-providers.sh` 的宽松本地检查
**Reason**：其 `curl -sS` 无条件接受代理 502、未校验 HTTP 状态与 JSON，产生假阳性。
**Migration**：替换为按 `--noproxy '*'` + `--fail-with-body` + JSON 校验 + 结构化输出的新实现。