# 深化：真实验收、自然语音、可靠更新与完整体验 Spec

## Why

上一次 `release-closure-natural-conversation` 迭代把状态机、打断、指标、知识/记忆、
可观测性做成了**真实可运行**的代码，但仍有几处“代码坦白承认未接线”的硬缺口
（见 `updater.rs` 注释、`ci.yml` 注释），以及健康检查结构校验、自然对话的语义分块与
回声抑制、部分 UX 尚未落地。本轮把这些缺口做成**真实可验证**的代码，而不是继续勾选 checklist。

## What Changes

- **正式接入 Tauri updater 插件**：不再只保留前端模拟与“未配置”上报。新增
  `tauri-plugin-updater` 依赖、`plugins.updater` 配置（stable/beta 双端点、公钥来自环境变量）、
  升级前数据库备份、迁移失败回滚与保留旧版本。真实端点/签名密钥缺失时保持 `UNVERIFIED`。
- **ruff + mypy 正式成为 CI 质量门禁**：加入 `pyproject.toml` dev 依赖，写入
  `[tool.ruff]` / `[tool.mypy]` 配置，CI 中作为硬性 gate 运行并修复全部违规。
- **启用真实 release workflow**：`release-gate` 从 `if: false` 空操作改为产出带
  版本、commit SHA、构建时间、校验值（checksums）的发布产物与 provenance 文件。
- **健康检查响应结构校验**：本地/远程适配器校验 HTTP 状态码、Content-Type、JSON 结构
  与关键字段；HTML 页、代理返回页、空响应、错误 JSON 一律不得误判为成功；补充
  流式分片/超时/限流/乱序/非法结构/中途断开的 mock + contract 测试。
- **自然对话深化**：流式 LLM→TTS 按句子/稳定语义片段切分下发；实现回声抑制/规避
  （优先系统 AEC、播报期间识别抑制与回声判定，绝不通过永久禁用插话来规避）。
- **知识/记忆体验闭环**：确认并补齐单文档重试、临时对话模式（不写长期记忆）、
  记忆条目的派生来源/修改/删除/“不再记录”，区分模型回答/知识事实/长期记忆。
- **隐私与 UX**：跟随系统深色/浅色，错误提示统一为“发生了什么/可能原因/下一步操作”，
  破坏性操作二次确认。

## Impact

- Affected specs: `release-closure-natural-conversation`（前一轮收尾）、`productization-reliability`。
- Affected code:
  - Rust/Tauri：`apps/desktop/src-tauri/Cargo.toml`、`tauri.conf.json`、`src/lib.rs`、`src/updater.rs`、`src/sidecar.rs`。
  - 前端：`apps/desktop/src/features/update/*`、`features/conversation/natural/*`、
    `features/knowledge/*`、`features/memory/*`、`features/settings/*`、`App.tsx`、`ui/*`。
  - 后端：`apps/sidecar/src/voxstudio_core/capabilities/*`、`readiness/*`、`knowledge/*`、`api/routes/*`。
  - CI/脚本：`.github/workflows/ci.yml`、`scripts/release-*.sh`、`apps/sidecar/pyproject.toml`。

## ADDED Requirements

### Requirement: 真实 Tauri 更新闭环
系统 SHALL 通过 `tauri-plugin-updater` 执行真实更新检查/下载/校验/安装，而非仅前端模拟。

#### Scenario: 更新已配置
- **WHEN** 设置了 `VOXSTUDIO_UPDATE_PUBKEY` 与 `VOXSTUDIO_UPDATE_ENDPOINT`，且检查到新版本
- **THEN** 应用下载更新、校验签名与版本递增、升级前自动备份数据库、安装失败保留旧版本与用户数据

#### Scenario: 更新未配置
- **WHEN** 缺少端点或公钥
- **THEN** UI 如实显示「未配置」，发布验收保持 `UNVERIFIED`，绝不伪造 PASS

### Requirement: ruff/mypy 质量门禁
系统 SHALL 将 ruff 与 mypy 配置为 CI 硬性门禁并修复全部违规。

#### Scenario: 代码含 lint/类型违规
- **WHEN** 提交代码触犯 `[tool.ruff]` / `[tool.mypy]` 规则
- **THEN** CI 失败，不得以“工具未配置所以跳过”通过

### Requirement: 健康检查结构校验
系统 SHALL 校验响应状态码、Content-Type、JSON 结构与关键字段。

#### Scenario: 返回 HTML/代理页/空响应/错误 JSON
- **WHEN** provider 返回非预期格式
- **THEN** 判定为失败并给出可执行中文提示，不得误判成功

### Requirement: 自然对话语义分块与回声抑制
系统 SHALL 按稳定语义片段流式下发 TTS，并对播报期间的麦克风回采做抑制/判定。

#### Scenario: 助手正在播报且用户说话
- **WHEN** 用户重新说话
- **THEN** 立即打断；同时播报期间不永久禁用插话，而是通过 AEC/识别抑制减少回采误识别

## MODIFIED Requirements

### Requirement: 发布验收真实性（修改自 release-closure）
系统 SHALL 记录发布产物版本、commit SHA、构建时间与校验值。

## REMOVED Requirements
无移除。