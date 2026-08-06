# Tasks

> 基线：`main` HEAD = `c76a5f83ecb88eda109fdd82282adc43dc67b60b`。当前 HEAD = `249cde4`。
> 原则：不删除功能、不降质量门槛、不用 Mock 冒充真实验证；完成一项提交一项到 `origin/main`。

## 阶段一：真实基线（P0）
- [ ] Task 1: 建立真实基线审计
  - [ ] 拉取 main 最新提交，记录 commit SHA（已确认 `c76a5f83`）
  - [ ] 检查最新 GitHub Actions 成功/失败状态与失败步骤完整日志（`gh run list` / `gh run view`）
  - [ ] 在干净环境执行全部现有门禁：tsc、vitest、vite build、ruff、mypy、pytest+覆盖率、sidecar 构建（Nuitka）、cargo fmt、cargo clippy `-D warnings`、cargo test、pnpm audit、uv audit、cargo audit、真实 sidecar 集成测试、universal bundle 构建
  - [ ] 输出「文档声称已完成 vs 代码/CI 实际证据」差异清单（`output/readiness-baseline.md`）
  - [ ] 验证：不得删除测试/降覆盖率/关 lint/宽泛 ignore/skip audit/continue-on-error；逐条记录真实结果

## 阶段二：P0 CI 与供应链安全门禁
- [ ] Task 2: 修复 Rust Clippy 与 cargo audit
  - [ ] 定位并修复 `apps/desktop/src-tauri` 全部 Clippy 错误/警告（`-D warnings`）
  - [ ] 定位 cargo audit 具体漏洞、受影响依赖链与可利用范围
  - [ ] 优先升级/替换受影响依赖；确实无法立即修复时，仅对不可利用且有充分证据的漏洞加精确、带到期时间与解释的临时例外
- [x] Task 3: 供应链与 Actions 加固
  - [x] 更新 Node 运行时到 20+（当前 CI setup-node 用 22，核对项目要求）与已弃用的 GitHub Actions 到兼容新版本
  - [x] 检查所有 Actions 固定到可信 SHA/版本，避免供应链漂移（新增 `dependabot.yml`）
  - [x] 为前端/Python/Rust 输出机器可读测试、覆盖率、审计报告（JUnit/XML/SARIF）
- [ ] Task 4: Release Gate 强保护与连续验证
  - [ ] 确保 Release Gate 仅在全部前置任务成功时运行（needs + 分支保护阻止红色 CI 合并）
  - [ ] 连续两次干净 runner 执行全部通过，避免缓存伪通过
  - [ ] 验证：全部门禁全绿；本地结果与 GitHub Actions 一致；输出修复前后结果与对应提交

## 阶段三：P0 真实发布与更新闭环
- [x] Task 5: 生产更新公钥注入与通道配置
  - [x] 检查 Tauri Updater 当前实现、配置注入与签名验证全过程（`updater.rs`、`lib.rs`、`tauri.conf.json`）
  - [x] 禁止正式构建使用开发占位公钥；将生产更新公钥以安全、可审计、不可被运行时任意替换的方式注入
  - [x] 配置 stable 与 beta 更新通道的真实 endpoint（fails-closed：缺失不提供更新）
- [ ] Task 6: 更新全链路实现与验证
  - [ ] 版本检查、清单签名验证、下载包校验
  - [ ] 安装前数据库与配置备份；安装、重启、数据迁移、迁移失败回滚
  - [ ] 签名错误拒绝安装；下载中断恢复或明确重试
  - [ ] 验证：Rust 单测 + 真实升级测试（上一版本安装→升级）+ 故意损坏升级包回滚测试
- [ ] Task 7: macOS 签名/公证与发布产物
  - [ ] Developer ID 签名、hardened runtime、entitlements、notarization、stapling
  - [ ] CI 生成 Universal DMG、SHA256SUMS、SBOM、provenance.json、签名与 notarization 结果
  - [ ] 配置真实 GitHub Release 或正式分发端点（不得只打印「请配置上传」占位）
  - [ ] 创建规范版本标签；package.json/Cargo.toml/pyproject.toml/tauri.conf.json/更新清单/Release 名称版本一致
  - [ ] 缺 Apple 证书/生产密钥时：保留完整自动化实现；相关任务标 `UNVERIFIED`；给出操作者最短凭据配置步骤；不得把未签名构建描述为正式发布

## 阶段四：P0 真实 Provider 验收
- [ ] Task 8: 建立统一 Provider Contract Test Suite
  - [ ] 覆盖本地模型服务、OpenAI-compatible、远程 GPU、飞书、STT/TTS/LLM/数字人能力发现与健康检查
  - [ ] 每个 Provider 至少验证 18 类场景：正确配置、缺配置、错密钥、Token 过期、无权限、限流、4xx、5xx、DNS 失败、连接超时、首包超时、流中断、非法 JSON、字段缺失、用户取消、重试恢复、自动解除熔断、日志不泄露密钥
- [ ] Task 9: Provider 能力模型与韧性
  - [ ] 明确能力模型、健康评分、指数退避+随机抖动、最大重试预算、熔断器、自动恢复探测、用户可理解降级原因、可配置回退优先级
  - [ ] Local-only/Privacy 模式禁止意外访问远程端点
  - [ ] 无真实凭据时 Mock 测试标记 `MOCK_VERIFIED`；真实服务验收标记 `REAL_VERIFIED` 或 `UNVERIFIED`

## 阶段五：P1 统一自然对话生命周期
- [ ] Task 10: 会话生命周期领域模型与单一状态源
  - [ ] 审查并行状态（ConversationUiState/streaming/error/recordingVoice/ttsFailed/avatarFailed/naturalState/naturalActive/DOM 状态/generation_id/conversation_id/avatar session）
  - [ ] 建立明确会话生命周期领域模型；区分领域状态/UI 派生状态/瞬时副作用/Provider 状态
  - [ ] 使 busy/speaking/canInterrupt/canSend/degraded/waitingForConfirmation 成为纯 selector 而非额外布尔
- [ ] Task 11: 异步事件身份与取消幂等
  - [ ] 所有异步事件携带 generation_id/conversation_id/session identity；过期事件拒绝并记录可诊断原因
  - [ ] 取消幂等：重复取消无副作用；迟到 token 不写消息；迟到 TTS 不播；迟到数字人流不显示
  - [ ] 人物切换/会话切换/应用退出/Sidecar 崩溃/网络重连建立统一 cleanup 协议
- [ ] Task 12: 控制器拆分与媒体管理
  - [ ] 避免 `document.querySelector` 控制媒体元素，改用显式 refs/媒体会话管理器
  - [ ] 消除不必要 eslint-disable；稳定回调用稳定事件模式/refs
  - [ ] 拆分 `useConversationController` 为 ConversationCommandCoordinator / MediaSessionCoordinator / ConversationSelectionController / MessageEditingController / ExportController / 纯 UI selector
  - [ ] 保持外部行为兼容，不删除功能
- [ ] Task 13: 生命周期测试矩阵
  - [ ] reducer transition table、非法/乱序/重复事件、cancel/restore/person switch/conversation switch/reconnect race、TTS 与数字人部分失败、StrictMode 双调用、组件卸载后回调、属性/状态机模型测试、随机事件 fuzz

## 阶段六：P1 自然对话深化
- [ ] Task 14: 端到端体验预算与 SLO
  - [ ] 采集指标：speech start→interim、speech end→final、submit→first token、first token→first audio、avatar→first frame、TTS 口型偏差、打断→静音、网络中断→恢复、单轮耗时、VAD 误触发、回声误判、有效打断、STT 低置信、降级率、各阶段失败率
  - [ ] 增加 P99、样本量、失败率、时间窗口；按设备/输入模式/Provider/网络/版本分组
  - [ ] 样本不足不显示「达标」；关键指标定义可配置 SLO 并加入性能回归测试
  - [ ] 只记录经隐私审查的结构化指标，不记录原始语音/敏感对话
- [ ] Task 15: 自适应 VAD 与轮次判断
  - [ ] 环境噪声基线、开始/结束阈值、最短语音、最大等待、口头停顿容忍
  - [ ] 改善轮次判断，避免短暂停顿过早提交
- [ ] Task 16: 低置信转写与回声/打断/设备
  - [ ] 低置信转写：可编辑转写、明确确认、撤销、重录音、切文字输入
  - [ ] 回声/打断全场景：外放、耳机、AirPods/蓝牙、助手说话时插话、助手声音被重新采集、同时说话
  - [ ] 设备热插拔与默认设备变化
  - [ ] 麦克风权限中途撤销：不崩溃/不死循环，自动转文字模式并提供打开系统设置操作
  - [ ] 数字人或 TTS 失败时文本回答继续可用并说明哪层降级

## 阶段七：P1 会话持久化与崩溃恢复
- [ ] Task 17: 幂等持久化与崩溃点
  - [ ] 明确用户/助手消息持久化事务边界
  - [ ] 每次提交唯一 client_message_id 与 generation_id；幂等写入避免重试重复消息
  - [ ] 处理崩溃点：消息已存但生成未开始、生成已开始但首 token 未到、部分 token 已存、回答完成但 TTS 未开始、TTS 播放中、数字人流播放中
  - [ ] 重启后明确展示：已恢复/未完成/已取消/可重试
- [ ] Task 18: 迁移备份与长会话
  - [ ] 数据库迁移前自动备份，失败恢复原库
  - [ ] 长会话分页、虚拟化、内存压力测试
  - [ ] 故障注入：Sidecar 强制终止、磁盘写满、数据库锁、文件损坏

## 阶段八：P1 知识库与长期记忆深化
- [ ] Task 19: 知识库评测与韧性
  - [ ] 建立含标准答案/预期来源/不可回答问题的离线评测集
  - [ ] 度量 Recall@K、MRR、引用准确率、无依据回答率、过期引用率
  - [ ] 支持重复文档/更新/删除/权限撤销/同步中断；增量索引原子切换，失败保留旧版
  - [ ] 识别冲突来源并在回答中展示；引用可定位到具体文档与片段；文档更新后显示引用版本与过期提示
- [ ] Task 20: 长期记忆模型
  - [ ] 每条记忆保存内容/来源消息/创建时间/最近使用/保存原因/置信度/敏感级别/作用域/有效期
  - [ ] 区分全局/人物/会话/临时记忆；健康/身份/财务/密码/Token 默认禁止自动保存
  - [ ] 用户可查看/编辑/禁用/删除/撤销删除/导出；回答使用记忆时提供来源说明
  - [ ] 删除人物/会话/账号时级联清理相关记忆与索引
  - [ ] 测试：记忆污染、错误记忆、冲突记忆、过期记忆

## 阶段九：P1 隐私与安全加固
- [x] Task 21: Threat model 与 SSRF/重定向防护
  - [x] 建立正式 threat model：Sidecar loopback API、Bearer token、自定义 base URL、飞书凭据、临时录音/肖像、数据库、更新机制、诊断包
  - [x] 自定义 URL SSRF 防护与本地网络策略；防止重定向绕过目标地址校验（`ssrf.py` + 单测 23 例）
- [x] Task 22: 脱敏与临时文件/密钥管理
  - [x] 所有日志/错误/指标/诊断导出统一脱敏（`sanitize.py` + `RedactionLogFilter` + secret-leakage 单测 15 例）
  - [~] 临时媒体文件随机名、最小权限、确定性清理；异常退出后下次启动清理遗留（部分实现）
  - [ ] 诊断包生成前预览与明确包含项
  - [ ] 评估数据库静态加密/敏感字段级加密，macOS Keychain 管理密钥
  - [ ] 生成 SBOM、构建来源、依赖许可清单；更新包/清单/回滚包完整签名验证测试

## 阶段十：P2 首次使用与日常体验
- [ ] Task 23: 首次启动与设备体验
  - [ ] 自动检测 OS/芯片/内存/磁盘/麦克风/摄像头/扬声器/模型服务/网络；给出可用/需配置/不可用
  - [ ] 一键修复或跳转按钮；支持仅文字/文字+语音/完整数字人三模式；按真实设备推荐并允许覆盖
  - [ ] 环境未满足不得进入无响应对话页
  - [ ] 麦克风/扬声器/摄像头选择器；音量测试、试听、预览、当前设备显示；设备拔出自动切换或可恢复提示；记录设备变化（不记录原始音视频）
- [ ] Task 24: 进度/错误/可访问性/i18n/性能
  - [ ] 模型下载/知识同步/数字人构建/更新下载：当前步骤、比例、已用时间、可取消、失败恢复；不显示虚假剩余时间；重启恢复未完成状态
  - [ ] 错误区分用户说明与技术详情；优先展示重试/切 Provider/切文字/开设置/复制 request_id/导出诊断；重复错误合并；重试防重复提交
  - [ ] 全流程键盘可操作；aria-live 宣告；焦点保持；reduced motion/高对比度；硬编码中文迁移到 i18n 资源；至少简中+英文架构，禁止新增散落硬编码
  - [ ] 性能基准：冷启动、Sidecar 启动、首页可交互；1 小时/8 小时连续对话内存/CPU/句柄/临时文件增长；数字人空闲降 CPU/GPU；后台暂停摄像头/麦克风/渲染；长会话虚拟化

## 阶段十一：补充测试矩阵
- [ ] Task 25: 补齐测试矩阵
  - [ ] 状态机模型测试、随机事件序列测试、弱网/断网恢复、Provider 超时与限流、Sidecar 崩溃重启、数据库迁移与回滚、更新签名失败、设备热插拔、麦克风权限撤销、扬声器回声/用户打断、长会话性能、长时间资源泄漏、多人物/多会话隔离、敏感信息脱敏、重复请求幂等、React StrictMode
  - [ ] macOS Apple Silicon 真机验收；若宣称支持 Intel 则增加 x86_64 runner 验收，否则删除含糊支持承诺

## 阶段十二：收口与交付
- [ ] Task 26: 最终验收与 Readiness 报告
  - [ ] 复核最终完成标准（CI 全绿、连续两次一致、无未解释高危漏洞、核心 Provider 各至少一次 REAL_VERIFIED 或明确 UNVERIFIED、真机指标、无已知竞态、签名 notarized DMG、真实 tag+Release、更新全链路通过、故障注入通过、无密钥泄漏、文档一致、依赖项明确状态）
  - [ ] 每阶段输出：审计发现/根因/修改文件/关键实现/测试/执行命令/结果/未验证外部条件/风险回滚/下一任务
  - [ ] 生成 `PRODUCTION_READINESS_REPORT.md`（commit SHA、CI 链接与状态、功能/Provider/指标/Security/Release 矩阵、已知限制、UNVERIFIED 清单、是否允许发布明确结论）
  - [ ] 逐项勾选 `checklist.md`；提交并推送 `origin/main`

# Task Dependencies
- [Task 1] 独立（最高优先，后续所有任务依赖其基线结论）
- [Task 2]/[Task 3] 独立（可并行）→ 汇总到 [Task 4]
- [Task 5]→[Task 6]→[Task 7] 串行（发布闭环）
- [Task 8]→[Task 9] 串行（Provider 验收）
- [Task 10]→[Task 11]→[Task 12]→[Task 13] 串行（统一生命周期）
- [Task 14]→[Task 15]→[Task 16] 串行（自然对话深化）
- [Task 17]→[Task 18] 串行（持久化）
- [Task 19]→[Task 20] 串行（知识/记忆）
- [Task 21]→[Task 22] 串行（安全）
- [Task 23]/[Task 24] 可并行（体验）
- [Task 25] 依赖多个阶段，可并行推进
- [Task 26] 依赖全部

## 并行可执行
- [Task 2]/[Task 3]/[Task 5]/[Task 8]/[Task 10]/[Task 14]/[Task 17]/[Task 19]/[Task 21]/[Task 23] 可并行
- [Task 25] 中各单项可并行