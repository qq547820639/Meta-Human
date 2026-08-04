# 生产级收敛与用户体验深化迭代 Spec

## Why
当前版本功能基本完整、自动化测试较多，但核心对话链路仍存在数据一致性、会话隔离、恢复契约、数字人切换与弱网可用性等生产级缺口：一次提问可能触发两次模型生成、会话详情契约不统一、模型上下文未按 `conversation_id` 隔离、默认数字人切换状态源不完整、构建任务用固定 `setInterval` 轮询易重叠。需把项目从「集成可用」推进到「核心链路数据一致、可恢复、可隔离、可真实发布验收」。

## What Changes
- 建立单一权威回复流水线，消除一次提问两次模型生成。
- 统一会话详情/消息恢复契约（`ConversationDetail` 或分页 messages 接口），删除静默空数组掩盖。
- 按 `conversation_id` 隔离模型上下文、历史、regenerate、记忆写入。
- 建立单一可观察的数字人选择状态源，打通启动/管理/对话/创建/重建链路。
- 重构构建任务轮询为递归 `setTimeout` 调度，带退避抖动、去重叠、断网恢复。
- 为每个数字人维护任务与远程资源关系，去除「全局最近任务」推断。
- 建立统一服务端分页协议与统一错误模型（`ApiError`）。
- 拆分超大组件，用 reducer/状态机表达并行状态。
- 补齐可靠性、无障碍、CI 质量门禁、桌面 GUI E2E 与发布工程。
- **BREAKING**：`/v1/conversations/{id}` 响应结构改为明确的 `ConversationDetail`（或新增 `/messages` 分页接口），前端不再读取不存在的 `messages` 字段。

## Impact
- 受影响 spec：`integration-convergence`（对话/恢复/轮询相关边界）、`productization-reliability`。
- 受影响代码：
  - 前端：`ConversationWorkspace`、`conversationClient`、`conversationManagementClient`、`avatarBuildClient`、`restoreClient`、`useRestoreState`、`CreationFlow`、`DigitalHumanManagement`、`App.tsx`、`api/client.ts`、`api/contracts.ts`。
  - 后端：`conversation.py`、`conversation_repository.py`、`build_job_service.py`、`build_job_repository.py`、`digital_human_repository.py`、`routes/conversation.py`、`routes/avatar.py`、`app.py`（CORS/错误中间件）。
  - 迁移：新增会话分页/数字人-任务关系/远程资源字段的增量迁移。

## ADDED Requirements
### Requirement: 单一权威回复流水线
系统 SHALL 保证一次用户发送只发生一次模型 LLM completion，只持久化一条用户消息与一条助手消息，且显示文本、保存文本、引用与 TTS 文本来自同一最终回答。

#### Scenario: 单次发送单次生成
- **WHEN** 用户在 `ConversationWorkspace` 点击发送一次
- **THEN** 只调用一次模型 provider；数据库只新增一条用户消息和一条助手消息；TTS 输入与界面最终显示文本完全一致；流式完成后不再次调用普通回复接口。

#### Scenario: 停止生成
- **WHEN** 用户点击停止
- **THEN** 同时取消流式请求、服务端生成、待执行 TTS、音频播放与头像驱动；不写入残留回复、不自动播放音频。

### Requirement: 会话详情与消息恢复契约
系统 SHALL 通过明确的 `ConversationDetail` 或 `/v1/conversations/{id}/messages` 分页接口提供会话元数据、消息、引用、分页游标/`has_more` 与恢复状态。

#### Scenario: 恢复会话
- **WHEN** 应用启动读取最近会话或切换会话
- **THEN** 前端读取真实非空消息列表（含顺序、角色、引用、时间戳、错误状态、附件元数据）；契约不符时返回结构化错误而非空会话；长会话游标分页。

### Requirement: 按 conversation_id 隔离模型上下文
系统 SHALL 使 `_build_prompt`、`_prompt_for`、历史查询、regenerate、删除最后回复、摘要与记忆写入均显式接收当前 `conversation_id`，普通会话不得读取其他会话消息。

#### Scenario: 双会话隔离
- **WHEN** 并行创建 A、B 两个会话并写入不同秘密标记
- **THEN** A 会话提示词中永不出现 B 会话标记；regenerate 不修改其他会话数据；临时/已删除/隐私模式会话不进入长期记忆。

### Requirement: 完成默认数字人切换与重建链路
系统 SHALL 建立单一可观察的数字人选择状态源，切换后主界面立即刷新，重建针对原 ID 且在失败时保留原可用版本。

#### Scenario: 切换默认数字人
- **WHEN** 用户设置默认数字人或在管理页切换
- **THEN** 主对话区头像/名称/配置/状态立即刷新，无需重启；切换时先停止旧头像流、旧音频与未完成任务；不播放上一个数字人残留音频。

### Requirement: 重构构建任务轮询与恢复
系统 SHALL 用递归 `setTimeout` 或统一调度器轮询，任意时刻同一任务最多一个在途请求，支持指数退避与随机抖动。

#### Scenario: 断网恢复
- **WHEN** 轮询期间网络暂时不可用
- **THEN** 一次网络错误不会把服务端任务标记为失败；网络恢复后自动继续查询；应用重启后从持久化任务 ID 恢复；区分服务端失败/网络/超时/鉴权/后台/用户取消。

### Requirement: 统一服务端分页
系统 SHALL 为会话、消息、数字人、构建任务与搜索提供统一分页协议（`cursor` 优先或 `limit+offset`），返回 `next_cursor`/`has_more`，前端「加载更多」真实请求服务器。

### Requirement: 统一错误模型
所有普通请求、Tauri invoke、SSE、转写、上传、导出 SHALL 使用同一错误模型（`code`/`message`/`request_id`/`retryable`/`recommended_action`/HTTP 状态/可安全展示的诊断信息），核心路径不得把结构化错误还原为普通字符串。

### Requirement: 拆分超大组件并建立确定性状态机
系统 SHALL 拆分 `ConversationWorkspace` 与 `CreationFlow`，用 reducer 或显式状态机表达并行状态（文本生成/TTS/头像流/录音/网络/恢复），定义合法状态转换与取消行为并附状态机测试。

## MODIFIED Requirements
### Requirement: 默认数字人状态源
由「各页面各自持有 `selectedHumanId`」改为「共享单一可观察状态源（启动恢复/管理/对话/创建共用）」，`selectedHumanId` 必须可读有效，不得只写不读。

### Requirement: 构建任务状态查询
由「全局最近一条构建任务推断所有数字人状态」改为「按数字人查询最新任务/任务历史/失败重试/远程清理能力」，保存 provider、remote resource ID、清理状态与最后错误；远程清理失败进入可恢复状态而非假装成功。

## REMOVED Requirements
### Requirement: 前端静默空数组掩盖
**Reason**: 前端把缺失 `messages` 静默转为空数组会掩盖契约不一致并显示空会话。
**Migration**: 改为契约不符时返回结构化错误；前端读取明确 `ConversationDetail` 或分页接口。

### Requirement: 固定 `setInterval` 轮询
**Reason**: 固定间隔轮询可能产生重叠异步请求。
**Migration**: 改为递归 `setTimeout` 调度，去重叠、退避抖动、断网恢复、页面隐藏降频、彻底清理。