# Checklist：真实代码路径闭环

## Task 1 真实 VAD
- [x] 生产默认路径真实调用 `navigator.mediaDevices.getUserMedia`，正确处理 `window.AudioContext`/`webkitAudioContext`
- [x] start/dispose 保存并关闭 AudioContext/MediaStream/source/analyser/rafId，无空帧循环伪装
- [x] 权限/Web Audio 不可用返回结构化降级原因并自动切入按住说话
- [x] enable/disable/重试/切换数字人/切换会话/卸载幂等无泄漏
- [x] 测试：默认接线、权限拒绝、重复启停、资源清理

## Task 2 真实 STT
- [x] `createMockSttSession` 仅存在于测试注入路径，生产无 mock fallback
- [x] 真实 sidecar STT 支持 AbortSignal/超时/取消/错误映射/request ID，Promise 有确定终点
- [x] 无流式 interim 时明确「录音后转写」真实降级，不展示虚假实时转写
- [x] 测试：无 Web Speech API 降级、sidecar 成功/失败/超时/取消/切换数字人

## Task 3 流式 LLM→分句 TTS
- [x] SSE token 真实增量文本传给 `onText`；`replyChunker` 按中英文标点与最大长度安全分句
- [x] `onTtsSentence` 调用真实 TTS，严格顺序 TTS 队列（预缓冲/背压/最大队列/失败降级），不并发 new Audio
- [x] epoch/turnId/generationId 隔离旧 turn 回调
- [x] 打断取消 LLM/待处理 TTS/下载/播放/avatar 并清空队列；全部音频块播放完才触发 `ASSISTANT_ENDED`
- [x] 测试：多句、快速 token、慢 TTS、乱序、部分失败、打断、切换数字人

## Task 4 真实 AEC 与回声门
- [x] 真实 `echoCancellation` 能力传入 `echoGate`；能力探测从一次真实 MediaStream 获取，不重复申请权限
- [x] 区分已启用/不可用/未知；无 AEC 仅抑制疑似短时回声，不禁止真实插话；真实播放状态/时间戳驱动
- [x] 记录 VAD 误触发率/回声抑制次数/有效插话次数（不含原始语音）
- [x] 测试：短脉冲回声、持续用户语音、快速插话、播放结束后讲话

## Task 5 avatar stream 闭环
- [x] `AvatarSession` 数据结构管理 创建→URL/token→续期→停止→重连
- [x] 恢复默认/管理页选择/创建成功三条路径均初始化真实 session，恢复 voice_id/avatar_id/provider_id，App 传流会话给 ConversationWorkspace
- [x] 不宽泛开放 CSP `media-src https:*`；优先 sidecar 回环代理，直连仅校验 origin 防任意 URL 注入
- [x] HLS/WebRTC/普通媒体对应播放器；连接中/首帧/断线重连/鉴权失效/流过期/静态降级/彻底停止状态
- [x] 声音 turn 与 avatar speaking action 共享生命周期，打断后不口型/旧动作
- [x] 测试：三入口路径、CSP、非法 URL、断线、资源释放

## Task 6 更新与发布闭环
- [x] 移除生产占位配置；stable/beta 明确构建期/安全运行期环境变量注入策略
- [x] CI 实际签名/公证/staple/验证/发布；signed 来自 `codesign --verify`+`spctl`，notarized 来自 notarytool+`stapler validate`
- [x] 发布后下载远端产物重算 SHA256 与 provenance 对比；updater 检查→下载→签名验证→安装→重启→迁移→版本确认
- [x] 数据库迁移前备份、升级失败回滚；缺正式配置时代码支持安全注入、CI 输出 UNVERIFIED
- [x] 修复 CHANGELOG 示例性 release 链接
- [x] 测试：updater manifest、签名失败、安装失败、回滚、迁移备份/恢复

## Task 7 CI 门禁绿色
- [x] 前端单测 + 真实 sidecar 集成测试、`cargo clippy -D warnings`、`cargo audit` 全通过；Release gate 实际运行非 skipped
- [x] cargo audit 无漏洞级告警；未加入无依据 ignore
- [x] CI Actions 版本与 runner 架构一致
- [x] 全新环境下全部 job 通过

## Task 8 首次使用与自然对话 UX
- [x] 引导式首次设置自动探测本地 OpenAI-compatible 服务与模型；权限拒绝展示具体权限/原因/系统设置入口
- [x] 麦克风电平/静音/噪声过高/STT 不可用/降级提示；状态全部来自真实事件
- [x] 转写文本短暂可编辑/撤销；首段播放后显示已播放与生成中内容
- [x] 自然/按住说话/纯文字三模式按设备能力自动推荐；avatar 断连/TTS 不可用/知识未同步提供可执行下一步

## Task 9 验收指标
- [x] 采集并测试 说话→首 interim、停说→final、提交→首 token、首 token→首段音频、插话→静音、avatar→首帧、断线→恢复
- [x] VAD 误触发率、回声自激率、TTS 队列乱序率、一小时对话资源变化
- [x] P50/P95 分位计算（未测量不伪造达标）

## Task 10 全量回归与交付
- [x] 全部门禁全新环境通过（ruff/mypy/pytest/coverage、tsc、vitest、build、cargo fmt/clippy/test、pnpm audit、uv audit、cargo audit）
- [x] 更新 README/CHANGELOG/release-checklists
- [x] 交付报告（commit SHA、文件清单、P0/P1/P2、根因/修复/测试名、门禁退出码、CI 状态、验收矩阵、延迟实测、签名证据、未完成项、人工验收流程）

## 最终验收
- [ ] 全部 CI job 绿色；Release gate 实际运行而非 skipped
- [ ] 生产代码中不存在 mock fallback
- [ ] 真实 VAD、STT、流式 LLM、分句 TTS、顺序播放、AEC、打断端到端工作
- [ ] avatar 流在创建/恢复/切换三条路径可用
- [ ] 生产 updater 公钥/端点/签名/公证/发布闭环完成或如实 UNVERIFIED
- [ ] 所有无法验证的外部条件均诚实标记 UNVERIFIED