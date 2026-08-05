# Tasks

## 第一阶段：P0 阻断问题（数据一致、可恢复、可隔离）

- [ ] Task 1: 单一权威回复流水线（消除一次提问两次生成）
  - [x] 审计 `ConversationWorkspace`/`conversationClient`/后端 `stream_reply` 调用链，确认一次发送仅一次 LLM 调用
  - [x] 流式完成后不得再次调用普通回复接口；确保显示/保存/引用/TTS 文本来自同一最终回答
  - [x] 停止生成同时取消流式、服务端生成、待执行 TTS、音频播放与头像驱动
  - [x] TTS 专用接口不重新调用检索或 LLM（或 SSE 返回 reply_id/引用/音频事件）
  - [x] 防组件卸载/切会话/快速连发导致旧请求覆盖新状态
  - [x] 集成测试：一次发送仅一次 provider 调用；仅新增一对用户/助手消息；音频输入=最终显示文本；中止后无残留回复/自动播放
  - [ ] 验证：pytest、vitest、真实 Sidecar E2E（pytest 与 vitest 已通过；真实 Sidecar E2E 待跑）

- [x] Task 2: 修复会话详情与消息恢复契约
  - [x] 后端 `/v1/conversations/{id}` 返回明确 `ConversationDetail`，或新增 `/v1/conversations/{id}/messages` 分页接口
  - [x] 删除前端「缺失 messages 静默转空数组」掩盖逻辑；契约不符返回结构化错误
  - [x] 启动恢复最近会话及真实消息；切换会话取消旧请求
  - [x] 保留消息顺序/角色/引用/时间戳/错误状态/附件元数据；长会话游标分页
  - [x] 真实 Sidecar 集成测试：创建→两轮消息→重启→恢复→断言内容/顺序/引用/数量非空一致
  - [x] 验证：pytest、vitest、真实 Sidecar E2E

- [ ] Task 3: 按 conversation_id 隔离模型上下文
  - [x] `_build_prompt`/`_prompt_for`/历史查询/regenerate/删除最后回复/摘要/记忆写入显式接收 `conversation_id`
  - [x] 普通会话上下文不得读取其他会话消息；regenerate 只改当前会话最后一条助手消息
  - [x] 跨会话长期记忆作为独立显式数据层；临时/已删除/隐私模式不入长期记忆
  - [x] 隔离测试：双会话不同秘密标记互不泄漏；regenerate 不改其他会话数据

- [x] Task 4: 完成默认数字人切换与重建链路
  - [x] 建立单一可观察数字人选择状态源（启动/管理/对话/创建共用）；`selectedHumanId` 可读有效
  - [x] 切换数字人立即刷新主界面；安全停止旧头像流/音频/未完成任务
  - [x] 「重新构建」传入原 ID/原素材/provider/远程资源标识/默认状态；区分新建/更新重建/复制
  - [x] 重建成功更新同一记录；重建失败保留原可用版本；远程资源替换/删除支持补偿与重试
  - [x] 测试：切换立即刷新；重启恢复默认；重建针对原 ID；失败保留原版；切换无残留音频

- [ ] Task 5: 重构构建任务轮询与恢复
  - [x] 递归 `setTimeout`/统一调度器，任意时刻同一任务最多一个在途请求
  - [x] 指数退避+随机抖动；区分服务端失败/网络/超时/鉴权/后台/用户取消
  - [x] 一次网络错误不标记服务端失败；网络恢复自动续查；重启后从持久化任务 ID 恢复
  - [x] 提供「连接中断重试/继续检查/复制诊断/取消任务」操作；页面隐藏降频、回前台刷新；彻底清理
  - [x] 验证：vitest（restore + creation 全绿）、pytest（后端任务机 7 项）、`pnpm tsc --noEmit` 通过

## 第二阶段：P1 稳定性与用户体验

- [x] Task 6: 每个数字人的任务与远程资源关系（按数字人查询任务/历史/重试/清理能力；保存 provider/remote ID/清理状态/最后错误；失败进入可恢复状态）
- [x] Task 7: 统一服务端分页（cursor 或 limit+offset；`next_cursor`/`has_more`；前端加载更多真实请求；51/500 条；虚拟化；搜索防抖+取消）
- [x] Task 8: 统一所有 API 与流式错误（`ApiError`：code/message/request_id/retryable/recommended_action/HTTP 状态/诊断信息；SSE 异常也生成 ApiError；按类型提供操作）
- [x] Task 9: 拆分超大组件并建立确定性状态机（`useConversationController`/`useStreamingReply`/`useVoiceRecording`/`useTtsPlayback`/`useAvatarSession`/`useConversationRestore`/Timeline/Composer/VoiceControls/RecoveryBanner/CreationWizard/BuildProgress；reducer 状态机+测试）
- [x] Task 10: 修复可靠性细节（录音 finally 清理；清空会话先等后端成功；破坏性操作显示对象名与影响范围；导出用原生保存对话框支持 MD/JSON 且含会话名/时间/数字人/模型/消息/引用/版本；设置脏状态/分区校验/连接测试/失败回滚；自动朗读/停止/重读/仅文字；首字/TTS 启动/头像就绪耗时指标；静默 catch 可观察化；删除旧对话实现）
  - [x] 录音临时文件在 `finally` 清理（`useVoiceRecording` 的 stop/transcribe 流程始终 `deleteMediaFile`，转写失败/取消也不泄漏）
  - [x] 清空会话先等后端成功再提交 UI（`performClear` 先 `clearConversationMessages` 成功后再清空本地，失败保留快照并提示）
  - [x] 破坏性操作显示对象名与影响范围（清空/删除对话框含会话名 `「xxx」` 及消息数量/不可撤销提示）
  - [x] 导出用 Tauri 原生保存对话框（Rust `save_text_file` command），支持 Markdown 与 JSON，含会话名/导出时间/数字人/模型/版本/消息/引用
  - [x] 设置页脏状态、分区校验、连接测试、保存失败回滚（`savedSettings` 快照回滚；`validateSettings` 校验；`ServiceStatusPanel` 一键检查；新增脏状态提示）
  - [x] 朗读控制：自动/停止/重新朗读/只生成文字（`useTtsPlayback` 提供 stopPlayback/replayLatest；`readOnly` 态）
  - [x] 耗时指标：首字/TTS 启动/完整回答/头像就绪（`conversationMetrics` + `useStreamingReply`/`useTtsPlayback`/`useAvatarSession`）
  - [x] 静默 catch 可观察化（错误置为可观察状态或带「best-effort/有意忽略」注释）
  - [x] 删除旧对话实现（`Conversation.tsx`/`ConversationStream.tsx` 及测试已删除；仓库仅剩 `ConversationWorkspace`）
  - [x] 验证：vitest（conversation 83 / settings+creation+restore 99 全绿）、`pnpm tsc --noEmit` 通过
- [x] Task 11: 无障碍与键盘体验（`aria-modal`、标题关联、焦点锁定、Escape 关闭、焦点恢复、Tab 顺序、SR 播报、reduced-motion、键盘发送/停止/录音/切会话、对比度与可见焦点）
  - [x] 封装 `useDialog` hook + `ConfirmDialog` 组件（`apps/desktop/src/ui/`）：弹窗打开聚焦首元素、Tab 在弹窗内循环、Escape 关闭、关闭后恢复触发点焦点
  - [x] 全部确认弹窗接入 `ConfirmDialog`（清空对话/删除对话/清空本地数据/重置设置/删除知识来源/删除数字人），`DigitalHumanManagement` 删除弹窗补齐 `aria-modal`/`aria-labelledby`
  - [x] 新增全局 `accessibility.css`（`main.tsx` 引入）：`:focus-visible` 覆盖按钮/输入/文本域/链接/`[tabindex]`，`conversation-modal` 遮罩+卡片样式，`prefers-reduced-motion` 关闭动画与滚动
  - [x] 键盘操作保底：Composer Enter 发送、停止生成/语音提问/切换会话均为可聚焦按钮（SR 播报沿用既有 `role="status"`/`role="alert"`，录音状态已 `role="status"`）
  - [x] 新增测试：焦点进入/恢复/Escape 关闭/Tab 循环/`aria-modal`/`aria-labelledby`/reduced-motion CSS/键盘发送-停止-录音
  - [x] 验证：`pnpm vitest run src/features`（260 通过）、`pnpm tsc --noEmit` 通过

## 第三阶段：P2 发布工程

- [ ] Task 12: 建立 CI 质量门禁（GitHub Actions：Python lint/type/test、TS type check、前端单测、Rust fmt/clippy/test、migrations、mock provider smoke、real-sidecar integration、构建、依赖漏洞扫描、覆盖率阈值、产物上传；超时+可读日志；失败不发布）
- [ ] Task 13: 增加完整桌面 GUI E2E（首次启动/创建数字人/导入知识/流式消息/停止/TTS/切会话/重启恢复/切默认数字人/弱网重试/导出/设置变更+Sidecar 重启）
- [ ] Task 14: 完成真实服务与发布验收（本地/远程 provider、飞书、真实 TTS/数字人、Developer ID 签名、notarization、stapling、干净 Mac 安装、离线启动、网络中断恢复、重启任务恢复、升级旧数据；缺凭证明确「未验证」）
- [ ] Task 15: 发布体验（应用内更新、稳定/测试通道、迁移回滚/备份、崩溃与 Sidecar 退出诊断、可导出诊断包、版本/构建号/changelog、隐私开关与数据删除说明、provider 数据发送范围说明）

## 第四阶段：交付与验收

- [ ] Task 16: 补齐全量回归测试并执行完整验证脚本（foundation/mock-provider/real-sidecar/DMG/provider-readiness/release-readiness），输出完成表与未验证清单

# Task Dependencies
- [Task 1] 独立（最高优先，先于 Task 2/3，因改动共流式/持久化）
- [Task 2] depends on [Task 1]（共用持久化与恢复）
- [Task 3] depends on [Task 1]
- [Task 4] 部分 depends on [Task 5]（重建涉及任务/远程资源）
- [Task 5] 独立
- [Task 6] depends on [Task 4]、[Task 5]
- [Task 7]/[Task 8] depends on [Task 2]
- [Task 9] depends on [Task 1]、[Task 2]
- [Task 10] depends on [Task 9]
- [Task 11] depends on [Task 9]
- [Task 12]/[Task 13]/[Task 14]/[Task 15] depends on 全部 P0/P1
- [Task 16] depends on 全部

## 并行可执行
- [Task 5] 与 [Task 1] 可并行
- [Task 7]/[Task 8] 在 [Task 2] 后可并行
- [Task 10]/[Task 11] 在 [Task 9] 后可并行
- [Task 12]/[Task 13] 在 P0/P1 后可并行