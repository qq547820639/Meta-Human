# 知识/记忆体验闭环 Spec

## Why
知识同步与长期记忆的后端能力已大多就绪，但前端体验闭环仍有关键缺口：用户无法查看记忆的原始来源、看不到知识来源的最后成功同步时间、删除对话时未明确衍生记忆的去向，且部分新增后端能力缺少测试保护。本 spec 关闭这些剩余缺口并补齐测试。

## What Changes
- 记忆条目支持「查看来源」：前端调用已有 `GET /v1/conversation/messages/{message_id}` 展示来源消息。
- 知识来源列表展示「最后成功同步时间」（`syncedAt`）。
- 删除对话/记忆的确认对话框明确说明衍生记忆（派生内容）是否一并删除。
- 为已实现的敏感信息规则、临时会话（`is_temporary`）、来源查询等新增后端与前端测试。
- 保持既有实现不变，最大化复用现有 backend/frontend，最小化变更。

## Impact
- Affected specs: knowledge/memory 能力域
- Affected code:
  - `apps/desktop/src/features/settings/MemoryPanel.tsx`（查看来源、删除确认）
  - `apps/desktop/src/features/settings/FeishuKnowledgePanel.tsx`（最后成功同步时间）
  - `apps/desktop/src/features/conversation/`（来源消息客户端函数）
  - `apps/desktop/src/features/memory/memoryClient.ts`（如需）
  - `apps/sidecar/tests/**`（后端测试补充）

## ADDED Requirements

### Requirement: 记忆来源可见
系统 SHALL 允许用户在记忆面板查看某条记忆对应的原始来源消息。

#### Scenario: 查看记忆来源
- **WHEN** 用户点击某条记忆的「查看来源」且该记忆存在 `source_message_id`
- **THEN** 面板展示该来源消息的内容与时间

#### Scenario: 来源为空的记忆
- **WHEN** 记忆没有 `source_message_id`
- **THEN** 「查看来源」不可用并给出提示

### Requirement: 知识来源最后成功同步时间可见
系统 SHALL 在知识来源列表展示每个来源的最后成功同步时间。

### Requirement: 删除确认明确衍生记忆
系统 SHALL 在删除对话/记忆的确认对话框中说明衍生记忆的处理方式。

#### Scenario: 删除对话
- **WHEN** 用户确认删除对话
- **THEN** 对话框明确说明由该对话派生的记忆是否一并删除

## MODIFIED Requirements
（无既有需求被修改；敏感信息规则与临时会话能力此前已实现，本次仅补测试覆盖。）

## REMOVED Requirements
无。