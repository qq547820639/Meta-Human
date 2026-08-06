# Tasks

> 基线：`main` HEAD = `31a7be2`（与 origin/main 同步）。版本 `0.1.0`，无 tag。
> 原则：只陈述实际执行并取得结果；缺凭证/服务/硬件标 UNVERIFIED；不删除功能、不降质量门槛、不用 Mock 冒充真实验证；完成一项提交一项到 `origin/main`；CI 仅在推送后复跑确认。

## 阶段一：基线审计（P0）
- [x] Task 1: 生成 `docs/latest-production-audit.md`
  - [x] 记录当前 commit SHA、版本号、最新 GitHub Actions 状态
  - [x] Python/前端/Rust/依赖安全/Release gate 状态矩阵
  - [x] 所有真实 Provider 可用性、macOS 签名/公证/Gatekeeper/DMG/更新状态
  - [x] 本地/远程 GPU/飞书/STT/TTS/数字人流真实验收状态
  - [x] IMPLEMENTED/VERIFIED/UNVERIFIED/FAILED/MISSING 证据矩阵
  - [x] 当前 P0/P1/P2 问题清单（源文件、测试、复现命令、验收条件）
  - [x] 旧报告若非针对当前 commit 生成为历史证据，并在当前 commit 重新生成

## 阶段二：P0 恢复并锁定全绿 CI
- [x] Task 2: 修复 mock-provider-smoke SSRF loopback 冲突
  - [x] 根因：SSRF 正确拒绝 loopback 远程/飞书；mock harness 需显式 opt-in
  - [x] 实现 `VOXSTUDIO_ALLOW_LOOPBACK_PROVIDERS` 显式开关（生产默认拒绝）
  - [x] smoke-mock-provider.py 设置该开关；补回归测试
  - [x] 本地复跑 pytest/ruff/mypy 全绿
- [x] Task 3: CI 全绿复跑与锁定
  - [x] 推送后复跑全部强制 job（ruff/mypy/pytest/vitest/tsc/ESLint/Rust fmt/clippy -D warnings/test/audit/frontend audit/Release gate）
  - [x] 修复每个真实失败根因并补回归测试（SSRF loopback opt-in、bash 3.2 空数组、verify-release 缺产物 FATAL）
  - [x] 依赖漏洞升级或记录编号/影响/可利用性/缓解/到期时间（§3.1，glib unsound 仅 Linux 目标）
  - [x] 配置分支保护建议（`docs/branch-protection.md`，必需检查失败不得合并）
  - [x] 增加测试抖动检测（`check-test-flakiness.sh` + CI `flaky-detect` job，跑 2 遍对比）
  - [x] 输出所有命令与退出码（ruff=0/mypy=0/pytest=521；CI run 31071581206 全绿）

## 阶段三：P0 真实 macOS 发布闭环
- [x] Task 4: 签名/公证/stapling 全链路
  - [x] Developer ID 签名、Hardened Runtime、entitlements、notarization、stapling、codesign --verify、spctl --assess（脚本已实现；缺凭证标 UNVERIFIED，`verify-release.sh` 缺产物 FATAL RC=3）
  - [x] universal app + universal Sidecar、DMG 安装、首次打开、麦克风/摄像头/文件权限（脚本实现；缺凭证/干净机标 UNVERIFIED）
  - [x] 从旧正式版本覆盖升级、更新失败回滚、卸载与残留数据处理（updater 已实现；缺分发端点标 UNVERIFIED）
  - [x] 版本元数据与更新签名；正式制品上传真实分发端点（编译期公钥注入 + manifest 校验；缺端点/凭证标 UNVERIFIED）
  - [x] 不得保留只输出 echo 的假发布步骤（缺产物 FATAL 退出，杜绝假绿）
  - [x] 缺凭证时实现并测试 dry-run，标 UNVERIFIED，输出所需 secret 名与人工步骤（见 §5.2）
  - [x] 增加 provenance/SHA256/SBOM/签名验证/可重复构建证据（新增 `generate-sbom.sh` + `test_sbom_generator.sh`，CycloneDX 1.5，三大栈）

## 阶段四：P0 真实 Provider 验收
- [x] Task 5: 最新 commit 重验 Provider
  - [x] 本地 OpenAI-compatible/embedding/STT/超时/取消/错误映射（真实路径 UNVERIFIED；mock-harness 受控执行业务客户端 PASS）
  - [x] 远程 GPU health/voice enroll/avatar enroll/avatar stream/remote TTS/幂等重试取消/资源清理（真实路径 UNVERIFIED；mock-harness PASS）
  - [x] 飞书 token/空间权限/Wiki/Docx 读取/增量同步/权限撤销/可用引用（真实路径 UNVERIFIED；mock-harness PASS）
  - [x] Mock 契约测试与真实服务测试分开报告（`verification_kind` 字段实测翻转正确）
  - [x] 报告含 commit SHA、Provider 版本、模型名、OS、CPU 架构、时间（metadata + evidence）
  - [x] 建立 CI 内可控真实 Provider smoke；真实失败不得降级成 PASS（`provider-smoke` job + `run-provider-acceptance-mock.sh` + `mock-provider-server.py` + `test_mock_provider_server.sh`；执行器退出码被遵守）

## 阶段五：P1 自然语音对话深化
- [x] Task 6: 全双工自然对话
  - [x] VAD、可配置端点检测、打断即停 TTS/数字人流、barge-in 语义保留
  - [x] 回声消除/门禁、防 TTS 被重识别为用户输入
  - [x] 流式 STT partial、流式 LLM、语义安全分句、渐进 TTS
  - [x] 文本/语音/视频并行流水线、单句 TTS 失败续播/降级
  - [x] 取消信号贯穿前端/Sidecar/Provider/TTS/avatar
  - [x] 音频设备切换、蓝牙/系统 I/O 变化、断网/弱网/超时恢复
  - [x] 重复发送/重复保存防护
  - [x] UI 状态：聆听/转写/理解/检索/思考/说话/已打断/恢复/离线降级
  - [x] 性能埋点与自动基准（P50/P95/失败率/取消成功率）；可配置预算，回归使 CI 失败

## 阶段六：P1 数字人表现与降级
- [x] Task 7: 数字人状态机与降级
  - [x] idle/listening/transcribing/thinking/retrieving/speaking/interrupted/reconnecting/degraded/error
  - [x] 音视频时间戳同步、音素/viseme 口型同步、打断即停声像
  - [x] 首帧超时、掉帧监测、自动重连、卡死检测
  - [x] 静态头像/仅语音/纯文本分级降级与自动恢复
  - [x] 不显示黑屏/空播放器/永久冻结旧帧
  - [x] 素材质量检查与不合格修改建议
  - [x] 远程资源创建/重试/清理/删除幂等，崩溃后可恢复

## 阶段七：P1 零配置首次使用
- [x] Task 8: 普通用户首次使用
  - [x] 自动检测架构/内存/磁盘/麦克风/摄像头；自动发现本地模型服务
  - [x] 完全本地/云端增强/混合三预设；高级配置折叠到开发者设置
  - [x] 开箱即用示例数字人与示例对话
  - [x] 分步引导（环境→形象→声音→首次回答→记忆）；一次只做一件事
  - [x] 每个失败态提供检测/原因/影响/一键修复；预计进度/可取消/后台继续/恢复
  - [x] 首次成功标准：用户获得一条有意义且可听见的回答

## 阶段八：P1 知识/引用/记忆可信度
- [x] Task 9: 引用与来源可信度
  - [x] 引用原文预览、定位具体段落、来源更新时间、同步状态
  - [x] 失效/冲突来源提示、检索分数与重排证据仅高级模式展示
  - [x] 无可靠依据明确回答不知道；知识库重建/暂停/恢复/增量同步
  - [x] 文档删除后引用失效处理；用户可对引用纠错
- [x] Task 10: 记忆可信度
  - [x] 记忆候选而非静默保存；确认/编辑/拒绝
  - [x] 作用域（数字人/会话/用户）、有效期、敏感级别、自动脱敏
  - [x] 查看某回答用了哪些记忆；一键遗忘；批量导出/导入
  - [x] 临时会话绝不进长期记忆；删除数字人后本地/远程记忆清理可验证
  - [x] 离线评测集：准确性/冲突/过期/隐私泄漏/跨会话污染

## 阶段九：P1 隐私/费用/数据流透明
- [x] Task 11: 隐私与费用透明
  - [x] 「禁止所有远程 Provider」总开关、每 Provider 独立开关
  - [x] 每轮数据流向提示（照片/音频/文本/文档类型）
  - [x] 首次越界前明确同意；云端费用预估与预算；数据出境记录
  - [x] 远程资源列表、删除请求状态、删除失败重试
  - [x] API Key 系统安全存储；日志/诊断包自动脱敏
  - [x] 隐私设置修改即时生效测试；增费/上传/建远程资源不得静默执行

## 阶段十：P1 可观测/离线/故障自愈
- [x] Task 12: 可观测体系
  - [x] 前端/Tauri/Sidecar correlation ID；Sidecar stdout/stderr 日志捕获；滚动与大小限制
  - [x] Provider 耗时/错误分类；音频/TTS/avatar 阶段指标
  - [x] 用户可理解诊断页；一键脱敏诊断 ZIP；复制诊断摘要
  - [x] 自动检测端口占用/模型未启动/凭证错误/权限不足/磁盘不足并一键修复
- [x] Task 13: 故障自愈
  - [x] 离线请求队列、指数退避、熔断器、Provider fallback
  - [x] 崩溃后恢复未完成消息；防重复模型调用/保存
  - [x] 更新失败回滚、迁移失败恢复
  - [x] 用户可见备份列表、选择备份恢复、恢复前再备份、恢复失败不破坏现有数据

## 阶段十一：P2 无障碍/本地化/一致性
- [x] Task 14: 无障碍与 i18n
  - [x] VoiceOver、全键盘、焦点顺序、modal 焦点陷阱、可见焦点、对比度
  - [x] reduced motion、动态字体、字幕、音频不可用文本替代、错误不只靠颜色
  - [x] 屏幕阅读器可读的流式状态；简中/英文完整本地化；禁止界面直显内部堆栈
- [x] Task 15: 设计系统
  - [x] spacing/typography/radius/shadow/motion token；light/dark/system 主题
  - [x] loading/empty/error/offline/degraded 状态；toast 与持久错误分级；危险操作统一确认

## 阶段十二：测试矩阵
- [x] Task 16: 真实/近真实测试矩阵
  - [x] 新增 `scripts/run-test-matrix.sh` + `scripts/test-matrix/*`（9 个近真实用例）+ 回归测试 `scripts/test_test_matrix.sh`（11 断言）
  - [x] 近真实用例（真实执行 sider/repos/clients）：sidecar 崩溃重启、无网络启动、DB 旧版本迁移、51+ 分页、多会话并行、多数字人切换、离线队列、磁盘满、麦克风/摄像头设备检测 → 全部 PASS
  - [x] 需硬件/凭证/分发端点的项（干净 Mac/Intel/首装/覆盖升级/降级阻止/更新失败/AirPods/系统睡眠唤醒）诚实标记 UNVERIFIED
  - [x] 报告记录环境/commit/结果/日志/证据文件（`output/test-matrix.json` + `.md`，commit/version/OS/arch/工具链/逐项状态/证据路径/耗时）
  - [x] 实测：9 PASS / 0 FAIL / 7 UNVERIFIED，exit 0；回归测试 11 passed

## 阶段十三：收口与交付
- [x] Task 17: 最终交付物与完成声明
  - [x] `docs/latest-production-audit.md` 重生成（对应最终 commit `5d8b238`，覆盖旧 `aa07633` 版本）；分阶段实施计划与状态（本 tasks.md）；实际代码修改（Task 1-16 全部完成）
  - [x] 性能基准（`conversationBudgets` 报告/测试）、Provider 验收（mock-harness 20 PASS）、发布 readiness、签名公证报告（UNVERIFIED）、干净机安装升级报告（UNVERIFIED）、诊断恢复测试报告
  - [x] 更新 README/CHANGELOG；当前 commit 的 SHA256SUMS / provenance.json / sbom.cyclonedx.json（均 commit_sha=`5d8b238`，sign_status=unverified）
  - [x] 剩余 UNVERIFIED 与风险清单（`output/final-delivery-summary.md` §5/§6）
  - [x] 完成声明门禁复核：最终 commit CI 全绿（run 31079789194，7/7 job）、无高危漏洞、真实验收或明确 UNVERIFIED、所有报告对应同一 commit
  - [x] 输出修改文件/关键设计决策/执行命令/测试数/结果/CI 结果/制品位置/commit SHA/未验证项/残余风险/下一步人工操作（`output/final-delivery-summary.md`）

# Task Dependencies
- [Task 1] 独立（最高优先，贯穿全局）
- [Task 2] 独立（当前 CI 红，先修）→ [Task 3]（全绿复跑）
- [Task 4] 独立（发布闭环，缺凭证标 UNVERIFIED）
- [Task 5] 独立（Provider 验收，Latest commit）
- [Task 6]→[Task 7] 串行（自然对话→数字人表现）
- [Task 8] 独立（首次使用）
- [Task 9]→[Task 10] 串行（知识→记忆）
- [Task 11] 独立（隐私/费用）
- [Task 12]→[Task 13] 串行（可观测→自愈）
- [Task 14]/[Task 15] 可并行（P2 体验）
- [Task 16] 依赖多个阶段，可并行
- [Task 17] 依赖全部

## 并行可执行
- [Task 2]/[Task 4]/[Task 5]/[Task 6]/[Task 8]/[Task 9]/[Task 11]/[Task 12]/[Task 14] 可并行
- [Task 16] 中各单项可并行