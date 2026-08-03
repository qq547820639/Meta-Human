# 跨层集成收口与用户体验深化 Spec

## Why

`productization-reliability` 迭代已把数字人持久化、构建任务状态机、会话模型、SSE 流式回答、统一错误协议、结构化引用与结构化记忆等**后端基础能力**建设完成并验证。但前端主路径并未真正接入这些新后端接口，导致前后端契约分裂、创建/恢复/停止/清理等核心流程在真实运行中不可用。本次迭代不是重新实现基础能力，而是**收口集成、修复契约、合并重复流程、补齐跨层测试**，把项目从"架构已实现但集成未收口"提升到"核心流程稳定可用"。

## 现状审计（基于代码事实，避免重复开发）

**已完整实现且有真实实现/单测覆盖（不重复开发）**
- 后端 `/v1/avatar/jobs` 全套：POST 创建、GET 详情、`/current`、`/cancel`、`/retry`、`/cleanup`（`avatar.py`、`build_job_service.py`）
- 后端数字人 CRUD：`/v1/avatar/humans` 列表/默认/详情/改名/默认切换/删除，字段 `creation_status`/`creation_progress`（`avatar.py`）
- 后端会话与消息模型、SSE 流式接口、`StopRequest(generation_id)`、`/v1/conversation/replies/stop`（`conversation.py` `routes/conversation.py`）
- 统一错误信封 `ErrorEnvelope` + 全局中间件 + request_id（`errors.py`、`app.py`）
- 结构化引用、结构化记忆（`knowledge/`、`routes/memory.py`）
- `AvatarStream` 远程启动/停止（`/v1/avatar/streams`）

**仅后端实现（前端未接入）**
- 构建任务 jobs API：前端 `avatarBuildClient.ts` 仍调用已删除的 `/v1/avatar/builds`（必然 404）
- 取消/重试/清理接口：前端仅在本地 `AbortController.abort()`，未调用服务端
- `/v1/avatar/jobs/current` 恢复：前端 `restoreClient.ts` 字段解析与后端契约不符

**仅前端实现（后端无对应）**
- 无（前端模拟的 TTS/playing 状态属于"伪实现"，非后端能力）

**前后端契约不一致（P0）**
1. 创建：前端 `/v1/avatar/builds` vs 后端 `/v1/avatar/jobs`
2. 数字人字段：前端读 `status` vs 后端 `creation_status`/`creation_progress`
3. 构建任务字段：前端读 `stage` vs 后端 `current_stage`/`stage_progress`/`succeeded_stages`/`retry_count`/`error_code`/`error_detail`/`cancelled`
4. 停止生成：前端不发送 `generation_id`，后端 `StopRequest` 强制要求
5. CORS：`allow_methods=["GET","POST"]`、`allow_headers=["Authorization"]`，拦截 PATCH/PUT/DELETE/Content-Type
6. `/jobs/current` 后端在无未完成任务时回退返回最近已完成任务（`build_job_service.current()`），违反"已完成任务不得误报为未完成"

**测试未覆盖的跨层契约**
- 无 `fetch` 未被 mock 的、连真实 Sidecar 的 E2E
- 无 CORS 预检（OPTIONS）覆盖 PATCH/PUT/DELETE/JSON/Authorization/Content-Type 的测试
- 无 StopRequest 必须含 generation_id 的契约测试
- 无"completed job 不作为 resumable"的回归测试
- 无前端解析真实 `DigitalHumanResponse`/`BuildJobResponse` 的契约测试

**需要真实外部服务验证（本次标记"未验证"，不 mock 代替）**
- 真实远程 GPU 头像创建/stream、真实声音注册、真实飞书 OAuth、App Store 签名/公证、Intel/Apple Silicon 干净安装

## What Changes

**第一阶段：阻断问题（P0）**
- 创建链路迁移到 `/v1/avatar/jobs`：记录准备、幂等 key、POST jobs、保存 job ID、轮询/订阅状态、展示 `current_stage`、成功后读取最终数字人、用持久化 voice/avatar ID 启动对话
- 取消改为服务端 `POST /jobs/{id}/cancel`；重试走 `POST /jobs/{id}/retry`；清理走 `POST /jobs/{id}/cleanup` 并区分本地/远程/不支持/待处理/失败/可重试
- 删除旧 `/v1/avatar/builds` 前端代码与测试
- 后端 `current()` 只返回未完成任务；新增 `/v1/avatar/jobs/recent` 语义清晰接口
- 统一数字人/构建任务响应类型（OpenAPI 生成 TS 类型或共享 schema + CI 校验），前端读取 `creation_status`/`current_stage` 等
- 前端 `restoreClient` 区分 loading/success/empty/error/retry，不吞掉 Sidecar 故障
- 停止生成：SSE 首事件 `generation_started` 带 `generation_id`，前端保存并随 `POST /replies/stop` 发送；本地停止 + 服务端停止
- CORS 允许真实方法（GET/POST/PUT/PATCH/DELETE/OPTIONS）与 headers（Authorization/Content-Type/X-Request-ID），仍拒绝不受信来源

**第二阶段：产品路径统一**
- 合并 `Conversation` 与 `ConversationStream` 为唯一 `ConversationWorkspace`，两条路径（新建/恢复）跑同一套 E2E
- 恢复最近会话并自动载入消息；未完成构建任务展示可操作恢复卡片（阶段/取消/重试/清理/错误详情）
- 语音/数字人阶段改为真实事件驱动（text_generation_started/token/completed、tts_started/completed/failed、audio_playback_*、avatar_stream_*、avatar_playback_completed），删除 `setTimeout` 模拟
- 数字人管理前端页面（列表/默认/改名/创建状态/远程状态/失败原因/重试/清理/删除/重新录制/重新创建头像）

**第三阶段：交互深化**
- 会话管理：debounce 搜索、取消过期请求、分页、活跃/归档筛选、加载/空/错误状态、重试、导出、删除确认弹窗（弃用"隔秒再点"）、当前会话高亮、新建聚焦
- 对话交互：重新生成（标记旧/新、替换或保留版本）、编辑重发、复制（单条/全部）、智能滚动（跟随 token/回顶按钮/分页）、流式性能优化（批量刷新/RAF/节流）
- 错误体验：统一 `ApiError`、展示可重试、复制 request_id、recommended action，不替换为通用字符串
- Settings 按用户任务拆分（首次启动向导/服务状态/本地模型/远程数字人/飞书知识库/我的数字人/会话与记忆/隐私/高级）；Provider 验证区分未配置/未验证/验证中/成功/网络/凭证/过期/权限/模型不存在/Space 不存在/版本不兼容；飞书做真实 token+space+权限+文档读取验证

**第四阶段：发布验收**
- 全量自动化检查（Python/Vitest/tsc/Vite build/Rust fmt+clippy/迁移/契约/E2E）
- DMG smoke；真实 provider 与签名公证项标记"未验证"并给出清单

## Impact

- 受影响规格：avatar build、conversation、restore、errors、settings、privacy、cors
- 受影响代码：
  - `apps/desktop/src/features/creation/`（avatarBuildClient、CreationFlow）
  - `apps/desktop/src/features/restore/`（restoreClient、useRestoreState）
  - `apps/desktop/src/features/conversation/`（合并 Conversation/ConversationStream → ConversationWorkspace、conversationStreamClient、conversationClient）
  - `apps/desktop/src/api/`（client.ts、OpenAPI 合约层）
  - `apps/desktop/src/features/settings/`（拆分 Settings）
  - `apps/desktop/src/features/humans/`（数字人管理页面，新增）
  - `apps/sidecar/src/voxstudio_core/api/app.py`（CORS）
  - `apps/sidecar/src/voxstudio_core/api/routes/avatar.py`（/recent、契约）
  - `apps/sidecar/src/voxstudio_core/providers/build_job_service.py`（current() 只返回未完成）
  - `apps/sidecar/src/voxstudio_core/api/routes/conversation.py`（generation_started 事件）
  - 前后端测试（契约、E2E、CORS、回归）

## ADDED Requirements

### Requirement: 构建任务创建主链路
系统 SHALL 通过 `/v1/avatar/jobs` 创建数字人，并在创建前准备/创建数字人记录与稳定幂等 key。

#### Scenario: 全新创建成功
- **WHEN** 用户从全新状态创建数字人
- **THEN** 系统创建数字人记录、POST jobs 得到 job ID、保存 job ID、按状态展示 `current_stage` 与阶段结果，构建成功后读取最终数字人数据并用持久化 voice/avatar ID 启动对话

#### Scenario: 取消不是只停前端
- **WHEN** 用户取消构建
- **THEN** 前端调用 `POST /jobs/{id}/cancel`、展示 cancelling、等待服务端进入终态，并明确无法立即停止时说明仍在处理中

#### Scenario: 失败阶段重试
- **WHEN** 声音注册成功但头像注册失败
- **THEN** 重试调用 `/jobs/{id}/retry`，仅重跑失败阶段，不重复创建远程资源

#### Scenario: 清理须区分结果
- **WHEN** 用户清理构建
- **THEN** 系统区分本地清理成功/远程清理成功/Provider 不支持远程删除/远程清理待处理/远程清理失败/可再次重试，未调用远程删除接口时不得显示"远程资源已清理"

### Requirement: 启动恢复契约
系统 SHALL 正确读取后端 `creation_status`/`current_stage` 等字段，并区分恢复状态。

#### Scenario: 重启后恢复
- **WHEN** 创建数字人后退出并重启应用
- **THEN** 系统自动恢复默认数字人、最近会话（并载入消息）、未完成任务，已完成任务不被误报为未完成

#### Scenario: 故障不被伪装成无数据
- **WHEN** Sidecar 不可达或授权失败
- **THEN** 恢复状态为 error（而非 empty），前端展示错误而非"没有历史数据"

### Requirement: 停止生成协议
系统 SHALL 在 SSE 首事件发送 `generation_started` 携带 `generation_id`，前端保存并随 `POST /replies/stop` 发送。

#### Scenario: 停止生成
- **WHEN** 用户点击停止
- **THEN** 前端立即置 stopping、本地停止消费 token、`POST /replies/stop` 携带 generation_id，按服务端返回展示 stopped/stop_failed；停止后不再触发 TTS/数字人播放

### Requirement: CORS 兼容
系统 SHALL 允许受信任桌面来源的真实方法与 headers，并拒绝不受信来源。

#### Scenario: 预检通过
- **WHEN** 前端发起 PATCH/DELETE/PUT/JSON POST，携带 Authorization/Content-Type/X-Request-ID
- **THEN** OPTIONS 预检通过，且不受信来源仍被拒绝

### Requirement: 统一对话工作区
系统 SHALL 提供唯一 `ConversationWorkspace`，新建/恢复/切换/新建会话均进入同一组件与状态模型。

#### Scenario: 两条路径一致
- **WHEN** 用户新建数字人后进入对话，或重启恢复后进入对话
- **THEN** 界面与能力一致，均支持 SSE/语音/TTS/数字人/停止/重生成/复制/引用/导出

### Requirement: 真实事件驱动语音与数字人阶段
系统 SHALL 用真实异步事件驱动 TTS/avatar 阶段，不使用固定 setTimeout 模拟。

#### Scenario: 失败降级
- **WHEN** 文本成功但 TTS 失败、或 avatar 失败
- **THEN** 保留文本并显示语音失败/数字人暂不可用，不阻塞文本

### Requirement: 数字人管理
系统 SHALL 提供前端管理页面，覆盖列表/默认/改名/创建与远程状态/失败原因/重试/清理/删除。

#### Scenario: 删除须区分本地与远程
- **WHEN** 用户删除数字人
- **THEN** 系统展示本地与远程删除结果，不得只删本地而让用户误以为远程已删

### Requirement: API 契约与类型统一
系统 SHALL 从 OpenAPI schema 生成或共享一套 TS 类型，覆盖数字人/构建任务/会话/消息/SSE event/StopRequest/引用/记忆/ErrorEnvelope，禁止前后端重复手写不同字段。

### Requirement: 跨层契约与 E2E 测试
系统 SHALL 提供未 mock fetch、连真实 Sidecar 的契约与 E2E 测试，覆盖创建/进度/取消/重试/重启恢复/最近会话/流式/停止/TTS 与 avatar 降级/会话 CRUD/数字人切换删除/隐私清理。

## MODIFIED Requirements

### Requirement: 现有构建任务 current 接口
将 `build_job_service.current()` 仅返回未完成/可恢复任务；新增 `/v1/avatar/jobs/recent` 返回最近任务（含已完成）。

### Requirement: 现有 CORS 配置
扩展 `allow_methods` 与 `allow_headers` 以覆盖真实请求，保持 `allow_origins` 为受信来源列表。

### Requirement: 现有取消/重试/清理前端
将前端本地 `AbortController` 取消替换为服务端 jobs 接口驱动，并正确展示结果。

### Requirement: 现有会话管理
移除"隔秒再点"式确认，改为明确确认弹窗，并补齐搜索/分页/筛选/状态/导出。

## REMOVED Requirements

### Requirement: 旧 `/v1/avatar/builds` 创建客户端
**Reason**: 后端已删除该接口，前端仍调用必然 404。
**Migration**: 前端迁移到 `/v1/avatar/jobs`，删除旧 `avatarBuildClient.ts` 中 buildAvatar 实现与对应测试。

### Requirement: 旧 Conversation 与 ConversationStream 重复流程
**Reason**: 两套页面拥有不同子集能力，导致路径不一致。
**Migration**: 合并为唯一 `ConversationWorkspace`，可复用展示组件，删除重复业务逻辑。