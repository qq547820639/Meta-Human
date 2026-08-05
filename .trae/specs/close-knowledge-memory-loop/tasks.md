# Tasks
- [x] Task 1: 记忆「查看来源」前端（Req6）
  - [x] SubTask 1.1: 在 conversation 客户端新增 `getSourceMessage(messageId)` 函数（调用 `GET /v1/conversation/messages/{id}`）
  - [x] SubTask 1.2: 在 `MemoryPanel.tsx` 为有 `source_message_id` 的记忆添加「查看来源」按钮，展示来源消息内容/时间
  - [x] SubTask 1.3: 为无来源记忆提供不可用提示
- [x] Task 2: 知识来源最后成功同步时间（Req1）
  - [x] SubTask 2.1: 在 `FeishuKnowledgePanel.tsx` 展示 `source.syncedAt`
- [x] Task 3: 删除确认明确衍生记忆（Req8）
  - [x] SubTask 3.1: 更新删除对话/记忆的确认话术，说明衍生记忆处理
- [x] Task 4: 补齐后端测试（Req9/Req7/来源查询）
  - [x] SubTask 4.1: 敏感规则 `should_persist` 用户可配置模式测试
  - [x] SubTask 4.2: 临时会话 `is_temporary` 端到端测试
  - [x] SubTask 4.3: 来源消息查询 API 测试
- [x] Task 5: 补齐前端测试
  - [x] SubTask 5.1: 为「查看来源」「删除确认」「最后成功同步时间」新增组件测试
- [x] Task 6: 验证（pytest / vitest / tsc）

# Task Dependencies
- [Task 5] 依赖 [Task 1]、[Task 2]、[Task 3]
- [Task 6] 依赖 [Task 1]-[Task 5]