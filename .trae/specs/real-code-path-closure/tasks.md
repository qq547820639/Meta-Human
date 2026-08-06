# Tasks

## 阶段 A：真实 VAD 与 STT 接线（真实媒体闭环基础）

- [x] Task 1: 修复真实 VAD 生产接线
  - [x] 生产默认路径真实调用 `navigator.mediaDevices.getUserMedia`，正确处理 `window.AudioContext`/`webkitAudioContext`
  - [x] start 时保存并持有 AudioContext/MediaStream/source/analyser/rafId；stop/dispose 逐个关闭，无空帧循环伪装
  - [x] 权限/Web Audio 不可用时返回结构化降级原因，Hook 自动切换到按住说话模式
  - [x] enable/disable/重试/切换数字人/切换会话/窗口卸载幂等无泄漏
  - [x] 测试：默认浏览器接线、权限拒绝、重复启停、资源清理

- [x] Task 2: 移除生产 mock STT，接通真实 sidecar STT
  - [x] `createMockSttSession` 仅保留在测试注入路径；删除生产 fallback
  - [x] 实现真实 sidecar STT（MediaRecorder 分块 / 已有 WAV 录音 / 分块转写），支持 AbortSignal/超时/取消/错误映射/request ID，Promise 有确定终点
  - [x] 无流式 interim 时明确进入「录音后转写」真实降级模式
  - [x] 测试：无 Web Speech API 降级、sidecar 成功/失败/超时/用户取消/切换数字人

## 阶段 B：流式 LLM→分句 TTS 顺序队列

- [x] Task 3: 接通流式 LLM→分句 TTS
  - [x] SSE token 事件把真实增量文本传给 `onText`；`replyChunker` 按中英文标点与最大长度安全分句
  - [x] `onTtsSentence` 调用真实 TTS（不生成 mock 音频），建立严格顺序 TTS 队列（预缓冲/背压/最大队列长度/失败跳过或文本降级）
  - [x] epoch/turnId/generationId 隔离旧 turn；打断取消 LLM/待处理 TTS/下载/播放/avatar 并清空队列
  - [x] 仅当前 turn 全部音频块播放完成后才触发 `ASSISTANT_ENDED`
  - [x] 测试：多句回复、快速 token、慢 TTS、乱序返回、部分失败、用户打断、切换数字人

## 阶段 C：真实 AEC 与回声门

- [x] Task 4: 真实 AEC 能力传递与回声门
  - [x] 把真实 `echoCancellation` 能力传给 `echoGate`；能力探测尽量从一次真实 MediaStream settings/capabilities 获取，不重复申请权限
  - [x] 区分已启用/不可用/未知；无 AEC 时仅抑制高度疑似短时回声，不禁止真实插话；用真实播放状态与时间戳驱动
  - [x] 记录 VAD 误触发率/回声抑制次数/有效插话次数（不记录原始语音）
  - [x] 测试：扬声器播放短脉冲回声、持续用户语音、快速插话、播放结束后讲话

## 阶段 D：数字人实时形象流闭环

- [x] Task 5: avatar stream 生命周期闭环
  - [x] 明确创建 session→URL/token→续期→停止→重连；引入 `AvatarSession` 数据结构
  - [x] 恢复默认/管理页选择/创建成功三条路径均初始化真实 session，正确恢复 voice_id/avatar_id/provider_id，并由 App 传给 ConversationWorkspace
  - [x] 不宽泛开放 CSP `media-src https:*`；优先 sidecar 回环代理，直连仅允许校验 origin 并防任意 URL 注入
  - [x] HLS/WebRTC/普通媒体分别实现对应播放器；增加连接中/首帧等待/断线重连/鉴权失效/流过期/静态降级/彻底停止状态
  - [x] 声音 turn 与 avatar speaking action 共享生命周期，打断后不继续口型/旧动作
  - [x] 测试：三入口路径、CSP、非法 URL、断线、资源释放

## 阶段 E：真实更新与发布闭环

- [x] Task 6: 移除更新占位配置并接通真实发布闭环
  - [x] 移除生产占位配置；stable/beta 明确构建期/安全运行期环境变量注入策略
  - [x] CI 实际执行签名/公证/staple/验证/发布；signed 来自 `codesign --verify`+`spctl`，notarized 来自 notarytool+`stapler validate`
  - [x] 发布后下载远端产物重算 SHA256 与 provenance 对比；updater 检查→下载→签名验证→安装→重启→迁移→版本确认
  - [x] 数据库迁移前备份、升级失败回滚；缺正式配置时代码支持安全注入、CI 输出 UNVERIFIED
  - [x] 修复 CHANGELOG 示例性 release 链接
  - [x] 测试：updater manifest、签名失败、安装失败、回滚、迁移备份/恢复

## 阶段 F：修复全部 CI 与依赖

- [x] Task 7: 修复全部 CI 门禁
  - [x] 前端单测 + 真实 sidecar 集成测试；`cargo clippy -D warnings`；`cargo audit` 全通过；Release gate 实际运行非 skipped
  - [x] cargo audit 优先升级/替换依赖，无漏洞级告警；未加入无依据 ignore
  - [x] CI Actions 版本与 runner 架构一致
  - [x] 全部门禁本地全新通过

## 阶段 G：首次使用与自然对话 UX

- [x] Task 8: 首次设置与自然对话状态 UX
  - [x] 引导式首次设置自动探测本地 OpenAI-compatible 服务与模型；权限拒绝展示具体权限/原因/系统设置入口
  - [x] 麦克风电平/静音/噪声过高/STT 不可用/降级提示；状态全部来自真实事件
  - [x] 转写文本短暂可编辑/撤销；首段播放后显示已播放与生成中内容
  - [x] 自然/按住说话/纯文字三模式按设备能力自动推荐；avatar 断连/TTS 不可用/知识未同步提供可执行下一步

## 阶段 H：验收指标与全量回归

- [x] Task 9: 生产级验收指标与性能测试
  - [x] 采集并测试 speech_start→首 interim、speech_end→final、提交→首 token、首 token→首段音频、插话→静音、avatar→首帧、断线→恢复
  - [x] VAD 误触发率、回声自激率、TTS 队列乱序率、一小时对话资源变化
  - [x] P50/P95 分位计算（`percentileLatencies`），未测量不伪造达标

- [x] Task 10: 全量回归与交付
  - [x] 全部门禁本地全新通过（ruff/mypy/pytest/coverage、tsc、vitest、build、cargo fmt/clippy/test、pnpm audit、uv audit、cargo audit）
  - [x] 更新 README/CHANGELOG/release-checklists；输出交付报告

# Task Dependencies
- [Task 1] 独立（最高优先）
- [Task 2] 独立
- [Task 3] 依赖 [Task 2]（真实 STT 与流式链路）
- [Task 4] 依赖 [Task 1]（复用真实 MediaStream 能力）
- [Task 5] 独立（avatar 生命周期）
- [Task 6] 独立（发布闭环）
- [Task 7] 依赖 [Task 1]-[Task 5]（修复各模块后门禁才绿）
- [Task 8] 依赖 [Task 1]-[Task 4]
- [Task 9] 依赖 [Task 1]-[Task 5]
- [Task 10] 依赖 全部

## 并行可执行
- [Task 1]/[Task 2]/[Task 5]/[Task 6] 可并行
- [Task 3] depends on [Task 2]
- [Task 4] depends on [Task 1]
- [Task 7]/[Task 9] 在阶段 A-D 后并行；[Task 10] 最后串行