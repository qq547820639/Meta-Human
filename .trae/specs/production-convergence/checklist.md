# Checklist：生产级收敛与用户体验深化迭代

## P0 阻断问题
- [ ] Task 1 单一权威回复流水线：一次发送仅一次 LLM 调用；用户/助手消息各持久化一次；显示/保存/引用/TTS 文本一致；停止生成同时取消流式/服务端/TTS/音频/头像；防卸载/切会话/连发竞态
- [ ] Task 1 集成测试：一次发送仅一次 provider 调用；仅新增一对消息；音频输入=最终文本；中止后无残留回复/自动播放
- [x] Task 2 会话详情契约：`/v1/conversations/{id}` 返回明确 `ConversationDetail` 或新增 messages 分页接口；删除前端静默空数组掩盖；契约不符返回结构化错误
- [x] Task 2 恢复与分页：启动恢复最近会话真实消息；切换会话取消旧请求；保留顺序/角色/引用/时间戳/错误状态/附件；长会话游标分页
- [x] Task 2 真实 Sidecar 集成测试：创建→两轮消息→重启→恢复→内容/顺序/引用/数量非空一致
- [ ] Task 3 会话隔离：`_build_prompt`/历史查询/regenerate/摘要/记忆显式接收 `conversation_id`；跨会话长期记忆独立数据层；临时/已删除/隐私模式不入长期记忆
- [ ] Task 3 隔离测试：双会话不同标记互不泄漏；regenerate 不改其他会话数据
- [x] Task 4 数字人切换：单一可观察选择状态源；`selectedHumanId` 可读；主界面立即刷新；安全停止旧头像流/音频/任务
- [x] Task 4 重建链路：区分新建/更新重建/复制；重建针对原 ID；失败保留原版；远程资源补偿与重试
- [x] Task 4 测试：立即刷新；重启恢复；重建原 ID；失败保留原版；无残留音频
- [ ] Task 5 轮询重构：递归 `setTimeout`/调度器；同任务单在途请求；指数退避+抖动；区分失败类型；网络恢复续查；重启恢复；页面隐藏降频；彻底清理

## P1 稳定性与体验
- [ ] Task 6 每数字人任务与远程资源关系（按数字人查询任务/历史/重试/清理；保存 provider/remote ID/清理状态/最后错误；失败进入可恢复状态）
- [ ] Task 7 统一服务端分页（cursor/limit+offset；next_cursor/has_more；前端真实加载更多；51/500 条；虚拟化；搜索防抖+取消）
- [ ] Task 8 统一 API 与流式错误（ApiError：code/message/request_id/retryable/recommended_action/HTTP 状态/诊断；SSE 异常也生成 ApiError；按类型提供操作）
- [ ] Task 9 拆分超大组件与确定性状态机（useConversationController 等 hooks；Timeline/Composer/VoiceControls/RecoveryBanner/CreationWizard/BuildProgress；reducer 状态机+测试）
- [ ] Task 10 可靠性细节（录音 finally 清理；清空会话先等后端；破坏性操作显示名与影响；导出生成 MD/JSON 含会话名/时间/数字人/模型/消息/引用/版本；设置脏状态/回滚；朗读控制；耗时指标；静默 catch 可观察化；删除旧对话实现）
- [ ] Task 11 无障碍与键盘（aria-modal/标题关联/焦点锁定/Escape/焦点恢复/Tab 顺序/SR 播报/reduced-motion/键盘操作/对比度）

## P2 发布工程
- [ ] Task 12 CI 质量门禁（Python lint/type/test、TS type check、前端单测、Rust fmt/clippy/test、migrations、mock smoke、real-sidecar、构建、漏洞扫描、覆盖率、产物上传；超时+日志；失败不发布）
- [ ] Task 13 桌面 GUI E2E（首次启动/创建数字人/导入知识/流式消息/停止/TTS/切会话/重启恢复/切默认数字人/弱网重试/导出/设置变更+Sidecar 重启）
- [ ] Task 14 真实服务与发布验收（本地/远程 provider、飞书、真实 TTS/数字人、Developer ID 签名、notarization、stapling、干净安装、离线启动、中断恢复、任务恢复、升级旧数据；缺凭证明确「未验证」）
- [ ] Task 15 发布体验（应用内更新、更新通道、迁移回滚/备份、崩溃与 Sidecar 退出诊断、诊断包、版本/changelog、隐私开关、数据发送范围）

## 回归测试
- [ ] Task 16 回归断言（单次模型调用；单条用户/助手消息对；TTS=显示文本；会话隔离；regenerate 隔离；重启恢复非空；51+ 分页；断网轮询恢复；无重叠轮询；切换立即刷新；重建正确 ID；失败重试清理；清空失败不丢数据；转写失败清理临时文件；错误保留 request_id/action；无竞态残留）

## 最终验收
- [ ] 完整验证脚本通过（foundation/mock-provider/real-sidecar/DMG/provider-readiness/release-readiness）
- [ ] 输出文件清单/架构决策/契约变化/测试覆盖/执行命令与真实结果/未验证项/风险/发布前剩余事项/P0-P2 完成表