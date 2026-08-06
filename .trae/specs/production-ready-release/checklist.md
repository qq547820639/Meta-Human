# Checklist：生产就绪发布

## 阶段一：真实基线
- [ ] 记入 commit SHA（`c76a5f83ecb88eda109fdd82282adc43dc67b60b`）与 CI 状态
- [ ] 干净环境执行全部现有门禁通过并如实记录
- [ ] 输出「文档声明 vs 代码/CI 证据」差异清单（`output/readiness-baseline.md`）
- [ ] 未通过删除测试/降覆盖率/关 lint/宽泛 ignore/skip audit/continue-on-error 制造全绿

## 阶段二：CI 与供应链安全门禁
- [ ] Rust Clippy `-D warnings` 全绿
- [ ] cargo audit 无未解释高危漏洞；临时例外精确、带到期与解释
- [ ] Node 20+ 运行时与 Actions 更新到兼容新版本并固定可信版本
- [ ] 前端/Python/Rust 输出机器可读测试/覆盖率/审计报告
- [ ] Release Gate 仅在全部前置成功时运行；分支保护阻止红色 CI 合并
- [ ] 连续两次干净 runner 结果一致

## 阶段三：真实发布与更新闭环
- [ ] 正式构建不使用开发占位公钥；生产公钥安全注入且不可被运行时替换
- [ ] stable/beta 真实 endpoint 配置（fails-closed）
- [ ] 版本检查/清单签名验证/下载校验/备份/安装/重启/迁移/回滚全链路通过
- [ ] 签名错误拒绝安装；下载中断可恢复或明确重试
- [ ] macOS 签名/notarization/stapling 完成（缺凭证则标 UNVERIFIED 并给最短操作步骤）
- [ ] Universal DMG、SHA256SUMS、SBOM、provenance.json、签名/公证结果生成
- [ ] 配置真实 GitHub Release 端点；创建规范版本标签；各版本号一致

## 阶段四：真实 Provider 验收
- [ ] 统一 Provider Contract Test Suite 覆盖本地/OpenAI-compatible/远程 GPU/飞书/STT/TTS/LLM/数字人
- [ ] 每个 Provider 至少验证 18 类故障场景
- [ ] 能力模型/健康评分/指数退避/最大重试/熔断/自动恢复/降级原因/回退优先级
- [ ] Local-only/Privacy 模式禁止意外访问远程端点
- [ ] 结果严格标记 `REAL_VERIFIED | MOCK_VERIFIED | UNVERIFIED`，无 Mock 冒充

## 阶段五：统一自然对话生命周期
- [ ] 单一领域状态源；busy/speaking/canInterrupt/canSend/degraded/waitingForConfirmation 为纯 selector
- [ ] 异步事件携带 generation_id/conversation_id；过期事件拒绝并记录原因
- [ ] 取消幂等（迟到 token/TTS/数字人流不生效）；重复取消无副作用
- [ ] 统一 cleanup 协议（人物/会话切换、退出、崩溃、重连）
- [ ] 消除 `document.querySelector` 媒体控制与不必要 eslint-disable
- [ ] 控制器拆分为 Coordinator/Controller/MediaSession/纯 UI selector
- [ ] 生命周期测试矩阵（transition table、race、StrictMode、卸载回调、fuzz）通过

## 阶段六：自然对话深化
- [ ] 端到端体验预算含 P50/P95/P99、样本量、失败率、时间窗口，按维度分组
- [ ] 关键指标定义 SLO 并加入性能回归测试；样本不足不显示达标
- [ ] 仅记录经隐私审查的结构化指标
- [ ] 自适应 VAD（噪声基线/阈值/最短语音/最大等待/停顿容忍）
- [ ] 轮次判断避免过早提交
- [ ] 低置信转写：编辑/确认/撤销/重录音/切文字
- [ ] 回声/打断全场景、设备热插拔、权限撤销降级、数字人/TTS 失败文本继续可用

## 阶段七：会话持久化与崩溃恢复
- [ ] 唯一 client_message_id/generation_id；幂等写入
- [ ] 覆盖全部崩溃点并重启后明确展示恢复状态
- [ ] 迁移前备份、失败恢复原库
- [ ] 长会话分页/虚拟化/内存压力测试
- [ ] 故障注入（Sidecar 终止/磁盘满/库锁/文件损坏）通过

## 阶段八：知识库与长期记忆
- [ ] 离线评测集；Recall@K/MRR/引用准确率/无依据率/过期引用率
- [ ] 原子索引切换；冲突来源展示；版本化引用
- [ ] 记忆字段完备、作用域分类、敏感默认禁存、用户管理、来源说明、级联清理
- [ ] 记忆污染/错误/冲突/过期测试通过

## 阶段九：隐私与安全加固
- [x] 正式 threat model 覆盖 Sidecar/Bearer/base URL/飞书/临时文件/数据库/更新/诊断包
- [x] SSRF 防护、本地网络策略、重定向防护（`ssrf.py` 单测 23 例）
- [x] 统一脱敏；secret leakage 测试通过；日志不泄露密钥（`sanitize.py` 单测 15 例）
- [ ] 临时文件随机名/最小权限/确定性清理；启动清理遗留
- [ ] 诊断包预览与包含项
- [ ] Keychain 密钥管理；SBOM/许可清单；更新包完整签名验证测试

## 阶段十：首次使用与日常体验
- [ ] OS/芯片/内存/磁盘/麦克风/摄像头/扬声器/模型/网络自动检测；可用/需配置/不可用
- [ ] 一键修复/跳转；三模式；按能力推荐并允许覆盖；环境不足不进无响应页
- [ ] 设备选择器与测试；热插拔处理；设备变化记录（不记录原始音视频）
- [ ] 进度/错误/可访问性/i18n/性能增强

## 阶段十一：测试矩阵
- [ ] 状态机模型/随机事件/弱网/超时限流/崩溃重启/迁移回滚/签名失败/热插拔/权限撤销/回声打断/长会话性能/资源泄漏/多人物隔离/脱敏/幂等/StrictMode 测试
- [ ] Apple Silicon 真机验收；Intel 支持有据或删除含糊承诺

## 阶段十二：收口
- [x] 复核最终完成标准全部满足或如实标注 UNVERIFIED（见 `PRODUCTION_READINESS_REPORT.md`）
- [x] 每阶段输出规定格式（审计/根因/文件/实现/测试/命令/结果/未验证/风险/下一任务）
- [x] 生成 `PRODUCTION_READINESS_REPORT.md`（含是否允许发布的明确结论）
- [ ] 全部变更提交并推送 `origin/main`