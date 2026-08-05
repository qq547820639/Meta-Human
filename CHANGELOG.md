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

[0.1.0]: https://github.com/example/voxstudio/releases/tag/v0.1.0