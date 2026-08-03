# Tasks

## 第一阶段：阻断问题（P0）

- [x] Task 1: 统一 API 契约与类型层
  - [x] 从 FastAPI OpenAPI schema 生成 TS 类型（或建立共享 schema + CI 校验），覆盖 DigitalHuman、BuildJob、Conversation、Message、SSE event union、StopRequest、Citation、Memory、ErrorEnvelope
  - [x] 前端 `apps/desktop/src/api/` 新增契约层，删除各文件重复手写的字段定义
  - [x] 新增类型契约测试：前端能解析真实 `DigitalHumanResponse`/`BuildJobResponse`/`ErrorEnvelope`
  - [x] 验证：tsc --noEmit、vitest、pytest

- [x] Task 2: 构建任务创建主链路（迁移 `/v1/avatar/builds` → `/v1/avatar/jobs`）
  - [x] 重写 `avatarBuildClient.ts`：创建/准备数字人记录、生成稳定 idempotency key、POST `/v1/avatar/jobs`、保存 job ID、查询/订阅状态、成功后读取最终数字人
  - [x] 取消：调用 `POST /jobs/{id}/cancel`，展示 cancelling，等待服务端终态，无法立即停止时说明仍在处理
  - [x] 重试：调用 `POST /jobs/{id}/retry`，复用成功阶段
  - [x] 清理：调用 `POST /jobs/{id}/cleanup`，区分本地/远程/不支持/待处理/失败/可重试
  - [x] 删除旧 `/v1/avatar/builds` 客户端代码与测试；更新 `test_app_route_gate.py` 断言为 `/v1/avatar/jobs`
  - [x] 新契约测试：创建 client 调用真实 endpoint、无法再用 `/v1/avatar/builds`
  - [x] 验证：vitest、tsc、pytest

- [ ] Task 3: 启动恢复契约修复
  - [ ] 后端 `build_job_service.current()` 仅返回未完成/可恢复任务；新增 `/v1/avatar/jobs/recent` 接口
  - [ ] 前端 `restoreClient.ts` 正确读取 `creation_status`/`creation_progress`/`current_stage`/`stage_progress`/`succeeded_stages`/`retry_count`/`error_code`/`error_detail`/`cancelled`
  - [ ] 恢复状态区分 loading/success/empty/error/retry；不吞掉 Sidecar 故障/授权失败/解析失败/数据库错误
  - [ ] 自动恢复最近会话 ID 并传入统一对话工作区，载入最近消息
  - [ ] 未完成构建任务展示可操作恢复卡片（阶段/已完成阶段/更新时间/继续跟踪/取消/重试/清理/错误详情）
  - [ ] 回归测试：completed job 不作为 resumable；Sidecar 故障返回 error 而非 empty
  - [ ] 验证：vitest、pytest

- [ ] Task 4: 停止生成协议修复
  - [ ] 后端 SSE 首事件发送 `generation_started` 携带 `generation_id`（或明确响应头），有稳定测试
  - [ ] 前端保存当前 generation ID，停止按钮：本地立即置 stopping + 本地停止消费 token + `POST /replies/stop` 携带 generation_id
  - [ ] 服务端停止须真正取消 async task、通知 provider 中止、停止后续 token/TTS/播放，并保存部分回答
  - [ ] 停止失败不静默吞掉；停止后可保留部分回答/重新生成/继续提问/查看失败原因
  - [ ] 契约测试：无 generation_id 时测试失败；前端必须发送真实 generation_id；服务端停止有集成测试
  - [ ] 验证：vitest、pytest

- [ ] Task 5: CORS 兼容
  - [ ] `app.py` 允许真实方法（GET/POST/PUT/PATCH/DELETE/OPTIONS）与 headers（Authorization/Content-Type/X-Request-ID），`allow_origins` 保持受信来源
  - [ ] 新增 OPTIONS 预检测试：PATCH 会话名、DELETE 会话、PUT 默认数字人、DELETE 数字人、JSON POST、Authorization、Content-Type
  - [ ] 用与 Tauri WebView 相同 Origin 做集成测试；仍拒绝不受信来源
  - [ ] 验证：pytest

## 第二阶段：产品路径统一

- [ ] Task 6: 合并为统一对话工作区
  - [ ] 新建 `ConversationWorkspace`，合并 `Conversation` 与 `ConversationStream` 的重复业务逻辑
  - [ ] 新建/恢复/切换数字人/切换会话/新建会话均进入同一组件与状态模型
  - [ ] 恢复最近会话并自动载入消息
  - [ ] 两条路径运行同一套 E2E 测试
  - [ ] 验证：vitest、tsc、pytest

- [ ] Task 7: 语音/数字人阶段真实事件驱动
  - [ ] 删除 `setTimeout` 模拟 TTS/playing 状态
  - [ ] 建立真实状态事件：text_generation_started/token/completed、tts_started/completed/failed、audio_playback_*、avatar_stream_starting/started/failed、avatar_playback_completed
  - [ ] 降级策略：文本成功+TTS 失败保留文本；TTS 成功+avatar 失败播放音频并提示；均失败保留纯文字；自动播放关闭时只准备音频；停止后不再执行后续 TTS/播放
  - [ ] 回归测试：TTS 状态不得由计时器模拟
  - [ ] 验证：vitest、pytest

- [ ] Task 8: 数字人管理前端页面
  - [ ] 列表/查看默认/切换默认/改名/创建状态/远程状态/失败原因/重试/清理/删除
  - [ ] 删除展示本地与远程结果，不误报远程已删
  - [ ] 重新录制声音、重新创建头像；切换数字人后更新当前对话上下文
  - [ ] 验证：vitest、tsc、pytest

## 第三阶段：交互深化

- [ ] Task 9: 会话管理体验
  - [ ] 搜索 debounce、取消过期请求、防晚返回覆盖；分页/无限滚动；活跃/归档筛选
  - [ ] 加载/空/错误状态、重试、导出入口、删除与清空确认弹窗、删除失败状态回滚、键盘操作、当前会话高亮、新建聚焦
  - [ ] 弃用"隔秒再点"式确认
  - [ ] 验证：vitest、tsc、pytest

- [ ] Task 10: 对话交互优化
  - [ ] 重新生成标记旧/新，可替换或保留版本；编辑重发并明确从该节点生成
  - [ ] 复制（单条回答/单条问题/全部）与反馈
  - [ ] 智能滚动（底部跟随 token、向上浏览不强制拉回、回到最新按钮、分页/虚拟列表）
  - [ ] 流式性能：批量刷新/RAF/节流，不逐 token 重建列表
  - [ ] 新建会话清空旧消息、置新 ID、空状态、首问后生成标题
  - [ ] 统一 ApiError，展示可重试/复制 request_id/recommended action
  - [ ] 验证：vitest、tsc

- [ ] Task 11: Settings 拆分与 Provider 验证
  - [ ] 按用户任务拆分：首次启动向导/服务状态/本地模型/远程数字人/飞书知识库/我的数字人/会话与记忆/隐私/高级
  - [ ] Provider 验证区分未配置/未验证/验证中/成功/网络/凭证/过期/权限/模型不存在/Space 不存在/版本不兼容
  - [ ] 飞书做真实 token+space+权限+文档读取验证
  - [ ] 普通用户不显示底层 API path 与复杂技术配置
  - [ ] 验证：vitest、tsc

## 第四阶段：发布验收

- [ ] Task 12: 全量自动化检查与 E2E smoke
  - [ ] Python 全部测试、前端全部测试、tsc --noEmit、Vite production build、Rust fmt、Rust Clippy、数据库迁移测试
  - [ ] 更新 E2E：启动真实 Sidecar，从前端 API client 发请求（不 mock fetch），覆盖首次启动/readiness/创建/进度/取消/重试/重启恢复/最近会话/流式/停止/TTS 与 avatar 降级/会话 CRUD/数字人切换删除/隐私清理
  - [ ] mock provider E2E、DMG smoke
  - [ ] 输出"未验证"清单（真实远程 GPU/声音/飞书/签名公证/Intel 与 Apple Silicon 干净安装）

# Task Dependencies
- [Task 1] 独立（契约层先行，供 Task 2/3/4 使用）
- [Task 2] depends on [Task 1]
- [Task 3] depends on [Task 1]
- [Task 4] depends on [Task 1]
- [Task 5] 独立
- [Task 6] depends on [Task 2]、[Task 3]、[Task 4]
- [Task 7] depends on [Task 6]
- [Task 8] depends on [Task 1]、[Task 2]
- [Task 9]/[Task 10] depends on [Task 6]
- [Task 11] 独立
- [Task 12] depends on 全部

## 并行可执行
- [Task 1] 与 [Task 5] 可并行
- [Task 2]/[Task 3]/[Task 4] 在 [Task 1] 完成后可并行
- [Task 9]/[Task 10]/[Task 11] 在 [Task 6] 完成后可并行