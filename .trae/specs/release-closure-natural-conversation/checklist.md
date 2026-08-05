# Checklist：正式发布闭环 + 自然对话体验深化

## P0 阻断
- [x] Task 1 smoke-providers.sh 无假阳性：绕过代理、仅 2xx、JSON 校验、区分失败类型、结构化输出、无真实 provider 非零退出；自动化测试覆盖代理 502/非 JSON/超时/拒连/401/403/404/429/500/合法响应/代理 env 下直连回环
- [x] Task 2 真实 provider 验收执行器：本地 OpenAI-compatible / 远程 GPU / 飞书 / 生命周期全部可执行；缺凭证标 UNVERIFIED；结果写 JSON+Markdown（时间/版本/commit/架构/证据）
- [x] Task 3 正式发布闭环：Developer ID 签名、notarization、stapling、Gatekeeper、arm64+x86_64、干净安装、首次权限、断网启动、覆盖升级、卸载清理、崩溃清理；缺证书如实 UNVERIFIED
- [x] Task 4 安全签名应用更新：更新检查/下载进度/签名验证/失败恢复/迁移前备份/回滚；双通道；缺密钥如实标注

## P1 自然对话与呈现
- [x] Task 5 自然对话：`idle→listening→transcribing→thinking→speaking→interrupted/reconnecting/error` 状态机（真实事件驱动）；VAD/分块 STT 临时转写/打断取消真实 generation_id/停止 TTS 与音频/防残留写入与播放/回声消除降噪 AGC/说话时降麦/弱网降级/按键vs自然切换/状态展示/性能预算（前端 vitest conversation 118 通过、tsc 干净；后端 test_conversation.py 17 通过，取消语义未破坏）
- [x] Task 6 数字人呈现：视频流/TTS/generation 统一生命周期；切换停止旧音频视频任务；loading/buffering/reconnecting/fallback；失败保留文字音频；静态人像自然降级；音画同步/口型/情绪；页面隐藏/休眠/网络切换恢复（vitest conversation 144、tsc 干净；后端 avatar API 9 通过）

## P1 门槛与知识记忆
- [x] Task 7 配置向导：本地服务自动探测、模型下拉、能力-模型校验、错误翻译为用户步骤、一键重试/权限/授权/选模型、数据范围说明、保存前校验+保存后真实验证、高级端点折叠
- [x] Task 8 知识库：增量同步与进度、新鲜度/失败原因、单文档启停/重同步/删除、引用展示、无依据标记、检索质量测试集（后端 416 测试通过；前端 335 单测通过、tsc 干净；样例检索评估输出 recall=1.0/citation=1.0/no_basis=0.2 至 output/evaluation.{json,md}）
- [x] Task 9 长期记忆：来源/时间、固定/编辑/删除/禁用/不再记住、显式vs系统记忆、作用域、注入前检查、隐私说明与彻底删除验证

## P1 可靠/可观测/无障碍
- [x] Task 10 可观测与诊断：结构化日志+request_id 全链路（header/error/log 同 id，客户端 id 校验/不跨请求泄漏/嵌套 async 传播）、脱敏诊断包（默认不含量本与媒体路径，关闭才含，密钥永不包含）、provider 延迟/错误率/取消率/降级率（聚合+端点+前端展示）、崩溃（重启一次后失败关闭）/迁移（失败留可恢复 .bak）/媒体泄漏（stale 候选清理）测试、长对话/大量会话/大量知识文档性能测试、遥测默认尊重隐私（指标端点不含用户内容）
- [x] Task 11 无障碍与全状态 UI：键盘完整操作、VoiceOver、字幕转写、reduced motion、高对比度/字体缩放、错误/空/加载/恢复状态 UI 测试（新增 21 例通过；features/ui/smoke 47 文件 402 通过、tsc 干净）

## 交付
- [x] Task 12 文档与全量回归：README/development/real-provider-acceptance/release-checklists/release-experience 更新；修复假阳性后重新生成 output 报告；全量测试通过（pytest 432/vitest 440/tsc/build/Rust fmt+clippy+test/migrations/mock smoke）；输出文件清单/架构/命令/结果/未验证项/人工与凭证步骤（`output/release-closure-natural-conversation-summary.md`）

## 最终验收
- [x] 所有现有测试继续通过（后端 432、前端 440、Rust、build、smoke 全绿）
- [x] 新增逻辑均有单元/集成/E2E/失败路径测试（自然对话/呈现/知识/记忆/配置/可观测/无障碍/验收执行器/签名更新均含测试）
- [x] PASS/FAIL/UNVERIFIED 与真实执行结果一致；无缺凭证测试被标为通过（本地 FAIL、remote/feishu/apple UNVERIFIED 如实记录）
- [x] 状态表述：真实 provider/签名/公证/干净安装未完成，声明「当前迭代已完成，但产品仍未达到生产发布完成状态」