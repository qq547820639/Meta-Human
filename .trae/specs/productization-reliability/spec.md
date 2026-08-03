# VoxStudio 产品化深化迭代（可靠性基础 + 核心体验）Spec

## Why

VoxStudio 的核心业务闭环已跑通，但当前实现是"功能完整的 MVP"：数字人创建走单次长 HTTP 请求、无持久化、无任务状态机；对话走单次阻塞请求、无流式；错误协议不完整；关键业务状态仅存于组件 `useState`。本次把项目从 MVP 提升到"稳定、可恢复、易使用、可维护"的正式发布质量，聚焦最高价值且可落地、可验证的改动。

## 现状审计（基于代码事实）

**已实现且质量合格（不重复实现）**
- Readiness 真实校验：本地模型 / 远程 GPU / 飞书均发真实请求（`readiness/service.py`、`capabilities/*`）
- 安全隔离：sidecar 回环监听 + 随机 bearer token、密钥存 macOS Keychain、日志脱敏（`security.py`、`keychain.rs`）
- 基础持久化：SQLite + 迁移框架（已有 001–007：readiness、knowledge、conversation_messages、conversation_memory、metadata、citation_urls、knowledge_fts）
- 基础错误信封：`ErrorEnvelope(code/message/retryable/recommended_action/request_id)` + 全局异常处理中间件（`errors.py`、`app.py`）
- 媒体采集、权限校验、TTS 音频合成、隐私清理/导出（`privacy.py`）

**部分实现（需深化）**
- 错误协议：缺 `technical_message`、`details`、`provider`、`provider_status`、`timestamp`，错误分类不完整
- 引用：仅通过"回答文本是否包含标题"推断来源（`conversation.py:160`），非结构化
- 记忆：单条覆盖式摘要（`memory.py`），非结构化条目，无管理 UI
- 对话：单一消息列表，无会话模型/标题/归档/搜索/分页/导出

**完全缺失（本次核心改造点）**
- 数字人持久化模型、构建任务状态机、幂等/取消/重试/补偿
- 流式对话、会话管理、停止生成/重新生成/编辑
- 结构化引用与校验、结构化记忆与用户管理
- 统一前端 API client、应用重启恢复

## What Changes

**第一阶段：可靠性基础**
- 新增数字人持久化模型（`digital_humans` 表，迁移 008）+ 仓库 + CRUD/默认接口
- 新增构建任务状态机（`build_jobs` 表，迁移 009）+ 任务服务 + 幂等/取消/重试/补偿/清理
- 升级统一错误协议（扩展 `ErrorEnvelope` + 错误分类 + 完整中间件）
- 新增统一前端 API client（`apiClient.ts`）
- 应用启动自动恢复：默认数字人、未完成构建任务、最近会话

**第二阶段：核心体验**
- 对话改为 SSE 流式，支持停止生成/重新生成/编辑重发
- 会话管理：会话模型 + 列表/标题/归档/删除/清空/搜索/分页
- 结构化引用：模型输出 `answer/used_source_ids/confidence`，服务端校验 source ID
- 结构化记忆：记忆条目表 + 分类/置信度/管理接口

**明确不在本次范围（记录原因，避免无限扩张）**
- 首次启动向导、完整视觉/可访问性改造、深色模式、E2E 套件、检索 reranking 深度优化、隐私导出完善 —— 依赖真实凭证/硬件、改动面大，单独迭代。

## Impact

- 受影响规格：readiness、conversation、avatar build、memory、knowledge、privacy、errors
- 受影响代码：
  - `apps/sidecar/src/voxstudio_core/persistence/migrations/`（新增 008、009）
  - `apps/sidecar/src/voxstudio_core/providers/avatar_build.py`（重构为任务系统）
  - `apps/sidecar/src/voxstudio_core/api/routes/avatar.py`、`conversation.py`（新接口 + 流式）
  - `apps/sidecar/src/voxstudio_core/knowledge/`（conversation、memory、retrieval）
  - `apps/sidecar/src/voxstudio_core/errors.py`、`api/app.py`
  - `apps/desktop/src/features/`（creation、conversation、settings）
  - `apps/desktop/src/api/client.ts`（新增）

## ADDED Requirements

### Requirement: 数字人持久化
系统 SHALL 持久化数字人记录，支持列表、详情、默认、改名、删除。

#### Scenario: 创建后重启恢复
- **WHEN** 用户创建数字人后关闭并重新打开应用
- **THEN** 系统从数据库恢复该数字人及其状态，无需重新创建

### Requirement: 构建任务状态机
系统 SHALL 以服务端 job 跟踪构建，支持阶段状态、幂等、取消、重试、补偿清理。

#### Scenario: 部分失败后重试
- **WHEN** 声音注册成功但头像注册失败
- **THEN** 任务保留成功阶段，重试仅重跑失败阶段，不重复创建远程资源

### Requirement: 统一错误协议
系统 SHALL 返回结构化错误，含 code/user_message/technical_message/retryable/recommended_action/request_id/details。

#### Scenario: 配置错误可区分
- **WHEN** 用户使用过期 token
- **THEN** 错误标记为凭证错误并在前端给出"重新授权"路径

### Requirement: 流式对话
系统 SHALL 以 SSE 流式返回对话，支持停止生成、重新生成、编辑重发。

#### Scenario: 文本逐步出现
- **WHEN** 模型开始输出
- **THEN** 文本 token 到达后立即显示，不等待 TTS

### Requirement: 会话管理
系统 SHALL 支持多会话，含标题、归档、删除、清空、搜索、分页。

### Requirement: 结构化引用
系统 SHALL 由结构化 source ID 驱动引用，并校验引用属于本次检索结果。

### Requirement: 结构化记忆
系统 SHALL 存储结构化记忆条目，支持分类、置信度、用户管理（列表/编辑/删除/确认）。

## MODIFIED Requirements

### Requirement: 现有 Conversation 服务
将 `reply` 从单次阻塞改为流式，并让 TTS 失败不影响文本回答，记忆生成失败不阻塞主回答。

### Requirement: 现有错误信封
扩展 `ErrorEnvelope` 字段，保留向后兼容（新增字段可选）。

## REMOVED Requirements

无删除。仅拆分/重构现有 avatar build 与 conversation 实现。