# Checklist：深化生产迭代

## 阶段一：基线审计
- [ ] `docs/latest-production-audit.md` 生成，含 commit SHA、版本号、CI 状态
- [ ] 各门禁状态矩阵（Python/前端/Rust/依赖安全/Release gate）
- [ ] 真实 Provider 可用性与 macOS 签名/公证/Gatekeeper/DMG/更新状态
- [ ] IMPLEMENTED/VERIFIED/UNVERIFIED/FAILED/MISSING 证据矩阵
- [ ] P0/P1/P2 问题清单（源文件/测试/复现命令/验收条件）
- [ ] 旧报告针对当前 commit 重新生成或明确标记为历史证据

## 阶段二：P0 恢复并锁定全绿 CI
- [ ] mock-provider-smoke SSRF loopback 冲突修复（显式 opt-in，生产默认拒绝）
- [ ] 全部门禁复跑全绿（ruff/mypy/pytest/vitest/tsc/ESLint/Rust fmt/clippy -D warnings/test/audit/Release gate）
- [ ] 每个失败根因修复并有回归测试
- [ ] 依赖漏洞升级或记录编号/影响/可利用性/缓解/到期时间
- [ ] 分支保护建议；测试抖动检测
- [ ] 当前 commit 所有强制 CI job 绿色，Release gate 实际执行并通过

## 阶段三：P0 真实 macOS 发布闭环
- [ ] 签名/公证/stapling/codesign --verify/spctl --assess 实现
- [ ] universal app + universal Sidecar、DMG 安装、首次打开、权限
- [ ] 覆盖升级、更新失败回滚、卸载与残留处理
- [ ] 版本元数据与更新签名；正式制品上传真实分发端点
- [ ] 无假发布步骤；缺凭证时 dry-run 标 UNVERIFIED + 输出 secret 名与人工步骤
- [ ] provenance/SHA256/SBOM/签名验证/可重复构建证据

## 阶段四：P0 真实 Provider 验收
- [ ] 本地/远程 GPU/飞书/STT/TTS/数字人重验
- [ ] Mock 契约与真实服务分开报告
- [ ] 报告含 commit SHA/Provider 版本/模型名/OS/架构/时间
- [ ] CI 内可控真实 Provider smoke；真实失败不降级为 PASS

## 阶段五：P1 自然语音对话深化
- [ ] VAD/端点检测/打断/barge-in/回声/防重识别
- [ ] 流式 STT partial/流式 LLM/语义分句/渐进 TTS
- [ ] 取消贯穿全链路；设备切换/蓝牙/断网/超时恢复；重复防护
- [ ] UI 全状态展示；性能埋点与自动基准，回归使 CI 失败

## 阶段六：P1 数字人表现与降级
- [ ] 统一状态机；音视频/口型同步；打断即停
- [ ] 首帧/掉帧/卡死监测、自动重连、分级降级与恢复
- [ ] 无黑屏/空播放器/冻结旧帧；素材质量检查；远程资源幂等

## 阶段七：P1 零配置首次使用
- [ ] 自动检测与环境发现；三预设模式；示例数字人/对话
- [ ] 分步引导；一次一个决定；每个失败态一键修复
- [ ] 首次成功=可听见的有意义回答

## 阶段八：P1 知识/引用/记忆可信度
- [ ] 引用预览/定位/更新时间/同步状态/失效冲突提示/纠错
- [ ] 无依据回答不知道；离线评测集
- [ ] 记忆候选确认/作用域/有效期/敏感级别/脱敏/遗忘/导出导入
- [ ] 临时会话不进长期记忆；删除数字人清理可验证；记忆污染/错误/冲突/过期测试

## 阶段九：P1 隐私/费用/数据流透明
- [ ] 远程总开关、每 Provider 开关、数据流向提示、越界同意
- [ ] 费用预估/预算/出境记录/远程资源列表/删除请求与重试
- [ ] API Key 安全存储、诊断脱敏、隐私设置即时生效；敏感行为不静默

## 阶段十：P1 可观测/离线/故障自愈
- [ ] correlation ID、日志捕获与滚动、Provider 指标、诊断页、脱敏 ZIP、一键修复
- [ ] 离线队列/退避/熔断/fallback/崩溃恢复/重复防护
- [ ] 更新回滚、迁移恢复、备份列表/选择恢复/恢复前再备份/失败不破坏数据

## 阶段十一：P2 无障碍/本地化/一致性
- [ ] VoiceOver/键盘/焦点/对比度/reduced motion/字幕/文本替代/流式状态可读
- [ ] 设计系统 token、主题、状态、toast 分级、危险确认、简中/英文、不直显堆栈

## 阶段十二：测试矩阵
- [x] Apple Silicon/Intel、安装/升级/降级/更新失败、断网、崩溃、设备切换、AirPods
- [x] 长会话/分页/多会话/多数字人、权限拒绝、迁移、磁盘满、睡眠唤醒
- [x] 测试报告记录环境/commit/结果/日志/证据文件
  - 实测：9 PASS / 0 FAIL / 7 UNVERIFIED，exit 0；报告 `output/test-matrix.json` + `.md`
  - 近真实用例（真实执行 sidecar/repos/clients）全部 PASS；需硬件/凭证/分发端点的项诚实标记 UNVERIFIED

## 阶段十三：收口与交付
- [x] 全部交付物产出（audit/计划/代码/测试/报告/README/CHANGELOG/SHA256/provenance/SBOM）
  - `docs/latest-production-audit.md`（对应 commit `5d8b238`）
  - `CHANGELOG.md`（P1/P2 交付条目）；`README.md`
  - `output/test-matrix.json/.md`、`output/provider-acceptance-mock-harness.json/.md`
  - `output/provenance.json`（commit_sha=`5d8b238…`、sign_status=unverified）
  - `output/SHA256SUMS`、`output/sbom.cyclonedx.json`（commit `5d8b238`，python=31/rust=588/javascript=179/total=798）
  - `output/final-delivery-summary.md`
- [x] 完成声明门禁复核（CI 绿、无高危漏洞、真实验收或明确 UNVERIFIED、报告对应同一 commit）
  - CI run `31079789194` 7/7 job 全绿；无高危可利用漏洞；P0-2/P0-3 明确 UNVERIFIED
- [x] 输出修改文件/设计决策/命令/测试数/结果/CI/制品/commit/未验证项/风险/下一步
  - 见 `output/final-delivery-summary.md`
- [ ] 提交并推送 origin/main（由编排者复核后执行，本交付不代提交/推送）