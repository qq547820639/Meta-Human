# Tasks

## 第一阶段：可靠性基础

- [x] Task 1: 数字人持久化模型与仓库
  - [x] 新增迁移 `008_digital_humans.sql`：`digital_humans` 表（id、name、voice_provider_id、avatar_provider_id、voice_id、avatar_id、creation_status、creation_progress、created_at、updated_at、is_default、error、portrait_path/recording_path 本地资源引用、remote 状态）
  - [x] 新增 `digital_human_repository.py`：CRUD、设置默认、按默认查询
  - [x] 新增单元测试 `test_digital_human_repository.py`

- [x] Task 2: 构建任务状态机
  - [x] 新增迁移 `009_build_jobs.sql`：`build_jobs` 表（job_id、avatar_id、current_stage、status、stage_progress、succeeded_stages、retry_count、error_code、error_detail、created_at、updated_at、cancelled）
  - [x] 新增 `build_job_service.py`：异步任务状态机（pending/running/succeeded/failed/cancelling/cancelled/cleanup_pending/cleanup_failed），阶段拆分（校验/上传照片/上传录音/注册声音/注册头像/保存结果/清理），幂等键去重、取消、重试、补偿清理
  - [x] 改造 `avatar.py` 路由：POST /v1/avatar/jobs（返回 job_id）、GET /v1/avatar/jobs/{id}、POST /v1/avatar/jobs/{id}/cancel、POST /v1/avatar/jobs/{id}/retry、POST /v1/avatar/jobs/{id}/cleanup
  - [x] 新增单元测试 `test_build_job_service.py`（部分成功、超时、取消、重试、补偿）

- [x] Task 3: 统一错误协议
  - [x] 扩展 `ErrorEnvelope`：新增 `technical_message`、`details`、`provider`、`provider_status`、`timestamp`（可选，向后兼容）
  - [x] 新增错误分类常量与 `recommended_action` 映射（参数/配置/凭证/权限/资源不存在/网络/超时/限流/模型不存在/格式不兼容/数据库/文件/任务已取消/任务冲突）
  - [x] 更新 `app.py` 中间件与各路由错误处理，注入 request_id、provider、timestamp
  - [x] 更新 `test_errors.py`、`test_error_contract.py`

- [x] Task 4: 统一前端 API client
  - [x] 新增 `apps/desktop/src/api/client.ts`：统一 fetch、解析错误协议、request_id 复制、retryable 控制、AbortController 支持
  - [x] 新增 `apiClient.test.ts`

- [x] Task 5: 应用重启恢复
  - [x] sidecar 启动时恢复默认数字人、未完成构建任务、最近会话
  - [x] 新增 GET /v1/avatar/current 或 startup 摘要接口
  - [x] 前端启动时拉取恢复状态，进入合理页面（`restoreClient.ts` + `useRestoreState` + App 集成）
  - [x] 集成测试覆盖重启恢复

## 第二阶段：核心体验

- [x] Task 6: 流式对话
  - [x] `conversation.py` 新增 SSE 流式回复接口（text 增量、阶段事件、引用、完成）
  - [x] 支持停止生成、重新生成、编辑重发（服务端）
  - [x] TTS 与文本解耦，TTS 失败不影响文本；记忆生成失败不阻塞
  - [x] 前端 `conversationClient.ts` 改为 SSE 消费，`Conversation.tsx` 分阶段展示
  - [x] 新增/更新测试

- [x] Task 7: 会话管理
  - [x] 新增迁移 `010_conversations.sql`：`conversations` 表（id、title、avatar_id、created_at、updated_at、last_message_at、archived、deleted、summary）+ 消息加 conversation_id 关联
  - [x] 新增会话仓库与服务：新建/列表/标题自动生成/改名/删除/清空/归档/搜索/分页
  - [x] 新增 conversation 路由（会话 CRUD）
  - [x] 前端会话列表与切换 UI（`ConversationManagement.tsx` + `conversationManagementClient.ts`）
  - [x] 新增测试

- [x] Task 8: 结构化引用
  - [x] 模型输出结构化格式（answer/used_source_ids/confidence/insufficient_context）
  - [x] 服务端校验 source ID 属于本次检索结果
  - [x] 前端展示引用片段与来源详情（`CitationList.tsx`）
  - [x] 新增测试

- [x] Task 9: 结构化记忆
  - [x] 新增迁移 `011_memory_entries.sql`：`memory_entries` 表（id、type、content、source_message_id、confidence、created_at、updated_at、last_used_at、confirmed_by_user、sensitive、expires_at）
  - [x] 新增记忆仓库与规则服务（分类、敏感不入库、低置信度需确认、冲突标记）
  - [x] 新增记忆管理路由（列表/按类型筛选/编辑/删除/确认/拒绝/清空）
  - [x] 前端记忆管理 UI（设置页）
  - [x] 新增测试

# Task Dependencies
- [Task 2] depends on [Task 1]（job 关联 digital_human）
- [Task 5] depends on [Task 1]、[Task 2]
- [Task 6] depends on [Task 3]（错误协议）、[Task 8]（引用）
- [Task 7] depends on [Task 6]
- [Task 9] 独立