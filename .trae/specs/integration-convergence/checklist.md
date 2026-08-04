# Checklist

## 第一阶段：阻断问题（P0）
- [x] 前端创建仅调用 `/v1/avatar/jobs`，旧 `/v1/avatar/builds` 代码与测试已删除
- [x] 创建主链路：记录准备 → 幂等 key → POST jobs → 保存 job ID → 状态展示 → 成功后读取最终数字人 → 用持久化 voice/avatar ID 启动对话
- [x] 取消调用 `POST /jobs/{id}/cancel` 并展示 cancelling/等待终态；重试复用成功阶段；清理区分本地/远程/不支持/待处理/失败/可重试
- [x] 后端 `current()` 只返回未完成/可恢复任务；新增 `/recent` 接口；completed 不作为 resumable
- [x] 前端读取 `creation_status`/`current_stage`/`stage_progress`/`succeeded_stages`/`retry_count`/`error_code`/`error_detail`/`cancelled`
- [x] 恢复状态区分 loading/success/empty/error/retry；Sidecar 故障/授权失败不伪装成"无数据"
- [ ] 恢复最近会话并自动载入消息；未完成任务展示可操作恢复卡片
- [x] SSE 首事件发 `generation_started` 携带 generation_id；前端停止发送真实 generation_id 到 `/replies/stop`
- [x] 服务端停止真正取消任务/通知 provider/停止后续 token/TTS/播放；停止失败不静默
- [x] CORS 允许 GET/POST/PUT/PATCH/DELETE/OPTIONS 与 Authorization/Content-Type/X-Request-ID，仍拒绝不受信来源
- [x] 新增 CORS 预检测试（PATCH/DELETE/PUT/JSON POST/Authorization/Content-Type）

## 第二阶段：产品路径统一
- [x] 唯一 `ConversationWorkspace`，新建/恢复/切换/新建会话进入同一组件与状态模型
- [x] 两条路径（新建/恢复）运行同一套 E2E，能力一致（SSE/语音/TTS/数字人/停止/重生成/复制/引用/导出）
- [x] 语音/数字人阶段由真实事件驱动，`setTimeout` 模拟已删除
- [x] 降级策略正确（文本成功+TTS 失败保留文本；TTS 成功+avatar 失败播放音频并提示；均失败保留纯文字；关闭自动播放只准备音频；停止后不再执行后续阶段）
- [x] 数字人管理页面：列表/默认/切换/改名/创建与远程状态/失败原因/重试/清理/删除（区分本地与远程删除结果）

## 第三阶段：交互深化
- [x] 会话管理：debounce 搜索/取消过期搜索/分页/活跃归档筛选/加载空错误状态/重试/导出/删除清空确认弹窗/删除失败回滚/当前会话高亮/新建聚焦
- [x] 弃用"隔秒再点"式确认
- [x] 对话交互：重新生成标记旧新/替换或保留版本、编辑重发、复制（单条/全部）、智能滚动、流式性能优化（批量/RAF/节流）
- [x] 新建会话清空旧消息/置新 ID/空状态/首问后生成标题
- [x] 统一 ApiError：展示可重试/复制 request_id/recommended action
- [x] Settings 按用户任务拆分；Provider 验证区分各类状态；飞书做真实 token+space+权限+文档读取验证

## 第四阶段：发布验收
- [x] Python 全部测试通过（344 项）
- [x] 前端全部测试通过（vitest，264 项，含 10 项真实 Sidecar E2E）
- [x] TypeScript 类型检查通过（tsc --noEmit）
- [x] Vite production build 通过
- [x] Rust fmt 与 Clippy 通过
- [x] 数据库迁移测试通过
- [x] 前后端契约测试通过（含 StopRequest 必须有 generation_id、completed 不作为 resumable、CORS 预检）
- [x] 真实 Sidecar E2E 通过（不 mock fetch）
- [x] mock provider E2E 通过
- [x] DMG smoke 通过
- [x] 输出"未验证"清单（真实远程 GPU/声音/飞书 OAuth/签名公证/Intel 与 Apple Silicon 干净安装）