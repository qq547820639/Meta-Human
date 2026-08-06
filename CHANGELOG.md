# Changelog

All notable changes to VoxStudio are documented here. Versioning follows
`MAJOR.MINOR.PATCH` and is kept in sync across the frontend
(`apps/desktop/package.json`), the Tauri config and Rust crate
(`apps/desktop/src-tauri/tauri.conf.json`, `Cargo.toml`), and the sidecar
(`apps/sidecar/pyproject.toml`). The pattern of each entry follows
[Keep a Changelog](https://keepachangelog.com/); the `Unreleased` section
tracks changes since the last tagged release.

## [Unreleased]

### Added
- 发布体验：迁移前自动备份数据库（`readiness.sqlite3.bak.<version>`），便于升级回滚。
- 发布体验：Sidecar 崩溃/退出诊断（崩溃标记、自动重建次数、最近退出码/错误），
  通过「设置 → 诊断」面板展示。
- 发布体验：可导出的诊断报告（应用版本、更新通道、构建提交、Sidecar 状态、
  配置摘要），不包含任何密钥/令牌。
- 隐私与数据：在「隐私与数据」面板补充 provider 数据发送范围与数据删除说明。
- **真实更新闭环**：正式接入 `tauri-plugin-updater`，前端更新流程改为驱动真实
  `update_check` / `update_download` / `update_install` 命令；stable/beta 双端点由
  环境变量注入；未配置端点/签名公钥时如实显示「未配置」，发布验收保持 `UNVERIFIED`。
- **CI 质量门禁**：将 `ruff` 与 `mypy` 正式配置为 CI 硬性门禁（`pyproject.toml`
  `[tool.ruff]` / `[tool.mypy]`），修复后端全部 ruff/mypy 违规。
- **发布产物溯源**：新增 `scripts/release-provenance.sh`，产出 `SHA256SUMS` 与
  `provenance.json`（版本、commit SHA、构建时间、各产物 sha256、签名/公证状态）；
  `release-gate` 从空操作改为真实构建 + 溯源 + 上传，发布到真实端点受签名凭证门禁，
  缺失时打印 `UNVERIFIED`。
- **健康检查结构校验**：`capabilities` 适配器校验 HTTP 状态码、Content-Type、JSON
  结构与关键字段；HTML 页、代理返回页、空响应、错误 JSON 一律判失败并给中文可执行
  提示；分阶段超时、取消信号、仅幂等操作自动重试；新增
  `test_readiness_structure_contract.py` 契约测试。
- **自然对话深化**：流式 LLM→TTS 按句子/稳定语义片段切分下发（`replyChunker.ts`）；
  播报期间回声门（`echoGate.ts`）优先信任系统 AEC、无 AEC 时抑制短突发回声，但
  用户持续插话仍可打断，绝不永久禁用插话。
- **知识/记忆体验**：记忆条目「查看来源」、删除/清空的确认对话框、删除会话时说明
  派生记忆是否被删除；「临时对话」模式（`is_temporary`，不写长期记忆）；敏感信息
  记忆写入规则可配置。
- **隐私与 UX**：跟随系统深色/浅色模式（`useTheme.ts` / `themes.css`）；错误提示统一
  「发生了什么 / 可能原因 / 下一步操作」结构；破坏性操作二次确认。
- **自然对话 UX 收口**：麦克风权限被拒时展示具体权限/原因与可直接打开的系统设置入口
  （`micSettings.ts`）；新增「纯文字」输入模式，与「自然」「按住说话」共三模式并按设备
  能力自动推荐；区分「正在生成声音 / 正在说话 / 等待确认 / 已降级为文字」等真实事件状态；
  转写文本支持清空（撤销）；avatar/TTS 不可用时给出可执行下一步。
- **验收指标**：新增 `percentileLatencies`（P50/P95 分位计算），基于真实采样计算，未测量
  不伪造达标。

## [0.1.0] - 2026-08-05

### Added
- 单一口径回复流水线：一次发送仅一次 LLM 调用，流式完成后不重复调用。
- 会话持久化与恢复：重启后恢复最近会话及其真实消息，长会话游标分页。
- 按 conversation_id 隔离模型上下文，跨会话长期记忆作为独立数据层。
- 数字人切换与重建链路（默认数字人、重建针对原 ID、失败保留原版本）。
- 构建任务轮询与恢复（指数退避 + 抖动、网络中断自动续查、从持久化任务恢复）。
- 任务与远程资源关系、统一服务端分页、统一 API 与流式错误契约。
- 可靠性细节：录音 finally 清理、原生保存对话框导出 MD/JSON、设置脏状态与回滚、
  朗读控制、耗时指标、删除旧对话。
- 无障碍与键盘体验、全局焦点样式与 reduced-motion。
- 本地/远程 provider 与飞书知识接入、结构化长期记忆。

[0.1.0]: https://github.com/qq547820639/Meta-Human/releases/tag/v0.1.0