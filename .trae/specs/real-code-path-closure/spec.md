# 真实代码路径闭环 Spec

## Why

上一迭代（`release-closure-natural-conversation`）以文档/清单收口为主，并明确声明「产品仍未达到生产发布完成状态」。当前最新 main（HEAD `546f436`）仍存在真实代码路径未闭环：生产 VAD 默认路径未真实调用 `getUserMedia`/`AudioContext`、生产环境仍有 `createMockSttSession` fallback、流式 LLM→分句 TTS 未真正接通、AEC 能力未传入回声门、avatar stream 生命周期未闭环、发布配置仍为占位符、且 CI 存在实际失败（前端测试、`cargo clippy -D warnings`、`cargo audit`、Release gate 被跳过）。

本轮任务的验收标准是「真实代码路径全部闭环」，而非补文档或勾选清单。禁止引入 mock fallback 冒充生产能力；所有异步任务必须可取消、可超时、可清理；无法在当前环境完成的外部验收一律如实标记 `UNVERIFIED`。

## What Changes

- **真实 VAD 接线**：生产默认路径必须真实调用 `navigator.mediaDevices.getUserMedia`，正确处理 `window.AudioContext`/`webkitAudioContext`，保存并在 stop/dispose 时关闭 AudioContext/MediaStream/source/analyser/requestAnimationFrame；无 AudioContext 时不得循环输入空帧假装聆听；权限/Web Audio 不可用时返回结构化降级原因并自动切换到按住说话模式；enable/disable/重试/切换/卸载全链路幂等无泄漏。
- **移除生产 mock STT**：`createMockSttSession` 仅允许存在于测试注入路径；实现真实 sidecar STT（MediaRecorder 分块 / 已有 WAV 录音 / 新的分块转写接口），支持 AbortSignal、超时、取消、错误映射、request ID；无流式 interim 时明确进入「录音后转写」真实降级模式，不得展示虚假实时转写。
- **接通流式 LLM→分句 TTS**：SSE token 事件把真实增量文本传给 `onText`；`replyChunker` 按中英文标点与最大长度安全分句；`onTtsSentence` 调用真实 TTS；建立严格顺序 TTS 任务队列（同一 turn 按序合成/播放），预缓冲、背压、最大队列长度、失败跳过或文本降级；每 turn 用 epoch/turnId/generationId 隔离，旧 turn 回调不得污染新 turn；打断时取消 LLM/待处理 TTS/下载/播放/avatar 并清空队列；仅当当前 turn 全部音频块播放完成后才触发 `ASSISTANT_ENDED`。
- **真正启用 AEC 与回声门**：把真实 `echoCancellation` 能力传入 `echoGate`；能力探测尽量从一次真实 MediaStream 的 settings/capabilities 获取，不重复申请权限；区分已启用/不可用/未知；无 AEC 时仅抑制高度疑似短时回声，不得禁止真实插话；用真实播放状态与时间戳驱动回声门；记录 VAD 误触发率/回声抑制次数/有效插话次数但不记录原始语音。
- **数字人实时形象流闭环**：明确 avatar stream 创建 session→URL/token→续期→停止→重连；使用 `AvatarSession` 数据结构而非临时 streamUrl；恢复默认、管理页选择、创建成功进入对话三条路径都必须初始化真实 avatar session；正确恢复 voice_id/avatar_id/provider_id；App 把有效流会话传给 ConversationWorkspace；不宽泛开放 CSP `media-src https:*`，优先 sidecar 回环代理，直连仅允许经过校验的 provider origin 并防任意 URL 注入；HLS/WebRTC/普通媒体分别实现对应播放器；增加连接中/首帧等待/断线重连/鉴权失效/流过期/静态降级/彻底停止状态；声音 turn 与 avatar speaking action 共享生命周期。
- **真实更新与发布闭环**：移除 `REPLACE_ME_WITH_PRODUCTION_ED25519_PUBKEY` 与 `updates.example.com`；stable/beta 明确构建期或安全运行期配置策略；配置真实 manifest/签名包/下载端点；CI 实际执行签名/公证/staple/验证/发布，不得仅 echo 占位；signed 状态必须来自 `codesign --verify`+`spctl` 成功，notarized 必须来自 notarytool 成功+`stapler validate` 成功；发布后下载远端产物重算 SHA256 与 provenance 对比；updater 在已安装旧版本上完成 检查→下载→签名验证→安装→重启→迁移→版本确认；数据库迁移前备份、升级失败回滚；无法提供正式配置时代码支持安全注入、CI 输出 UNVERIFIED、不得自称正式发布完成；修复 CHANGELOG 中示例性 release 链接。
- **修复全部 CI 失败与依赖问题**：前端单测+真实 sidecar 集成测试、`cargo clippy -D warnings`、`cargo audit`、Release gate；cargo audit 优先升级/替换依赖，仅当明确不影响构建且有官方说明与到期时间时才加带说明临时 ignore；升级有弃用警告的 Actions 版本；runner 架构与注释及 universal build 一致；所有 job 在全新无缓存环境重新通过。
- **首次使用与自然对话 UX**：引导式首次设置自动探测本地 OpenAI-compatible 服务与可用模型；不要求普通用户理解 base URL/endpoint/模型字段；权限拒绝时展示具体权限、原因与可执行系统设置入口；麦克风电平/静音/噪声过高/STT 不可用/降级模式提示；状态区分 聆听/检测到讲话/转写中/等待确认/思考/生成声音/说话/重连/降级为文字，且状态来自真实事件而非计时器；转写文本短暂可编辑/撤销；首段播放后继续生成时同时显示已播放与生成中内容；自然/按住说话/纯文字三模式按设备能力自动推荐；avatar 断连/TTS 不可用/知识未同步提供可执行下一步。
- **生产级验收指标**：采集并测试 speech_start→首 interim、speech_end→final、提交→首 token、首 token→首段可播音频、插话→实际静音、avatar session→首帧、avatar 断线→恢复、VAD 误触发率、回声自激率、TTS 队列乱序率、一小时对话内存/MediaStream/AudioContext/DOM 变化；为关键延迟设合理 P50/P95 门槛，未测量不得伪造达标。
- **测试与实施原则**：VAD 接线/权限拒绝/重复启停/资源清理；无 Web Speech API 降级；sidecar STT 契约与取消；流式 token→分句→TTS 队列；多音频块顺序播放；打断整条流水线；旧 turn 隔离；AEC 能力传递与回声门；avatar 三入口路径；CSP 与不可信 URL；updater manifest/签名失败/安装失败/回滚；迁移前备份与恢复；DMG 启动冒烟；长时重复启停资源泄漏。Mock 仅用于确定性单测；至少保留一组真实 sidecar 集成测试；真实外部 provider 无凭证时跳过并标 UNVERIFIED。

## Impact

- 受影响规格：natural-conversation、avatar-presentation、updater、release、onboarding、observability。
- 受影响代码：
  - `apps/desktop/src/features/conversation/natural/vadAdapter.ts`
  - `apps/desktop/src/features/conversation/natural/stt.ts`
  - `apps/desktop/src/features/conversation/natural/naturalConversationCore.ts`
  - `apps/desktop/src/features/conversation/natural/replyChunker.ts`
  - `apps/desktop/src/features/conversation/useNaturalConversation.ts`
  - `apps/desktop/src/features/conversation/conversationClient.ts`
  - `apps/desktop/src/features/conversation/ConversationWorkspace.tsx`
  - `apps/desktop/src/features/conversation/useAvatarPresentation.ts`
  - `apps/desktop/src/App.tsx`
  - `apps/desktop/src/features/human/DigitalHumanSelectionContext.tsx`
  - `apps/desktop/src/api/contracts.ts`
  - `apps/desktop/src-tauri/tauri.conf.json`
  - `apps/desktop/src-tauri/src/updater.rs`
  - `apps/desktop/src-tauri/src/lib.rs`
  - `.github/workflows/ci.yml`
  - `scripts/build-universal.sh`、`scripts/release-dmg.sh`、`scripts/release-provenance.sh`
  - `docs/release-checklists.md`、`CHANGELOG.md`、`README.md`
  - sidecar STT/avatar/provider 接口与 SSE 路由
  - 数据库迁移接口

## ADDED Requirements

### Requirement: 真实 VAD 生产接线
系统生产默认路径 SHALL 真实调用 `navigator.mediaDevices.getUserMedia`，并使用 `window.AudioContext`（含 `webkitAudioContext` 回退）分析音频；启动后 SHALL 保存并持有 AudioContext/MediaStream/source/analyser/rafId，并在 stop/dispose 时逐个关闭，避免泄漏。

#### Scenario: 正常聆听
- **WHEN** 用户启用自然对话且麦克风与 Web Audio 均可用
- **THEN** VAD 从真实麦克风音频帧检测说话起止，返回 `active` 真实状态，无空帧循环伪装

#### Scenario: 权限或 Web Audio 不可用
- **WHEN** `getUserMedia` 拒绝或 AudioContext 不可用
- **THEN** 返回结构化降级原因，Hook 自动切换到可真实工作的按住说话模式，不得假装处于聆听状态

#### Scenario: 重复启停与切换
- **WHEN** enable/disable/重试、切换数字人、切换会话或窗口卸载
- **THEN** 所有操作幂等且无资源泄漏（MediaStream 轨道、AudioContext、raf 均被正确关闭）

### Requirement: 移除生产 mock STT
系统生产路径 SHALL 使用真实 sidecar STT；`createMockSttSession` 仅允许通过测试注入参数传入，禁止作为生产 fallback。

#### Scenario: 无 Web Speech API 但有真实 sidecar
- **WHEN** 启动 STT 且 Web Speech API 不可用
- **THEN** 使用 sidecar STT（MediaRecorder 分块/WAV/分块转写），支持 AbortSignal/超时/取消/错误映射/request ID，每个 Promise 有确定的成功/失败/超时/取消终点

#### Scenario: 无流式 interim
- **WHEN** sidecar 暂不支持流式 interim transcript
- **THEN** 明确进入「录音后转写」真实降级模式，不展示虚假的实时转写能力

### Requirement: 流式 LLM→分句 TTS 顺序队列
系统 SHALL 将 SSE token 真实增量文本传给 `onText`，`replyChunker` 按中英文标点与最大长度安全分句，`onTtsSentence` 调用真实 TTS，并由严格顺序队列按序合成与播放。

#### Scenario: 多句回复顺序播放
- **WHEN** LLM 流式返回多句回复且 TTS 合成速度慢
- **THEN** 音频按生成顺序合成并按序播放，带预缓冲与背压，不并发 new Audio

#### Scenario: 打断
- **WHEN** 用户打断当前 turn
- **THEN** 取消 LLM、待处理 TTS、下载、播放与 avatar 动作并清空队列；仅当前 turn 全部音频块播放完成后才触发 `ASSISTANT_ENDED`

#### Scenario: 顺序乱序返回
- **WHEN** 网络导致 token/TTS 乱序返回
- **THEN** epoch/turnId/generationId 隔离保证旧 turn 文字/TTS/音频/avatar 回调不污染新 turn

### Requirement: 真实 AEC 与回声门
系统 SHALL 将真实 `echoCancellation` 能力传入 `echoGate`，能力探测尽量从一次真实 MediaStream 的 settings/capabilities 获取，并用真实播放状态与时间戳驱动回声门。

#### Scenario: 有 AEC
- **WHEN** 系统提供真实 AEC
- **THEN** 回声门使用真实能力抑制回声，不重复申请麦克风权限

#### Scenario: 无 AEC
- **WHEN** AEC 不可用
- **THEN** 仅抑制高度疑似短时回声，不得禁止真实用户持续插话

### Requirement: avatar stream 生命周期闭环
系统 SHALL 用 `AvatarSession` 数据结构管理创建 session→URL/token→续期→停止→重连，并在恢复默认/管理页选择/创建成功三条路径初始化真实 session。

#### Scenario: 三条路径初始化
- **WHEN** 恢复默认数字人、从管理页选择、创建成功进入对话
- **THEN** 均初始化真实 avatar session，正确恢复 voice_id/avatar_id/provider_id，并传给 ConversationWorkspace

#### Scenario: 不安全媒体
- **WHEN** avatar 流 URL 不可信或直连未经校验的 provider origin
- **THEN** 通过 sidecar 回环代理，直连仅允许校验后的 origin，防止任意 URL 注入；HLS/WebRTC/普通媒体使用对应播放器

### Requirement: 真实更新与发布闭环
系统 SHALL 使用真实生产更新公钥、endpoint、签名与公证流程，signed/notarized 状态必须来自真实工具验证结果。

#### Scenario: 生产配置缺失
- **WHEN** 当前环境无法提供正式签名/公证/端点凭证
- **THEN** 代码支持安全注入，CI 输出 UNVERIFIED，不得自称正式发布已完成

#### Scenario: 已安装旧版本升级
- **WHEN** 在已安装旧版本上执行更新
- **THEN** 完成 检查→下载→签名验证→安装→重启→数据迁移→版本确认，迁移前备份且失败可回滚

## MODIFIED Requirements

### Requirement: 全部门禁绿色
系统的最新 main SHALL 全部 CI job 绿色，Release gate 实际运行而非 skipped；`cargo audit` 优先升级/替换依赖，仅当明确不影响构建且有官方说明与到期时间时才加带说明的临时 ignore。

### Requirement: 首次使用与 UX
系统 SHALL 提供引导式首次设置自动探测本地 OpenAI-compatible 服务与模型，并把 聆听/检测到讲话/转写中/等待确认/思考/生成声音/说话/重连/降级为文字 等状态全部来自真实事件。

## REMOVED Requirements

### Requirement: 生产 mock fallback
**Reason**: 生产环境使用 `createMockSttSession` 等 mock 冒充真实能力，STT mock 的 stop() 依赖测试调用 emitFinal，真实用户可能永久等待。
**Migration**: mock 仅保留在测试注入路径；生产路径改为真实 sidecar STT 与真实分句 TTS。