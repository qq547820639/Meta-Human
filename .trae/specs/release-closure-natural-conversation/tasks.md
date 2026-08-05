# Tasks

## 第一阶段：P0 修复 provider 假阳性 + 真实验收体系

- [x] Task 1: 重写 `scripts/smoke-providers.sh` 消除假阳性
  - [x] 本地 provider 检查：`curl --noproxy '*' --fail-with-body --silent --show-error --max-time`，仅接受 HTTP 2xx，校验 `/api/tags` 为合法 JSON（非空/非 HTML/非代理错误页）
  - [x] 区分 DNS、连接拒绝、超时、401/403、404、5xx、格式错误；输出结构化 PASS/FAIL/UNVERIFIED 与可执行修复建议
  - [x] 远程 GPU / 飞书 / Apple 检查不以「环境变量存在」通过，改为安全/有界/无破坏性真实检查；无真实可用 provider 时非零退出
  - [x] 新增自动化测试：代理 502 但 exit 0；200 但非 JSON；超时/连接拒绝；401/403/404/429/500；合法响应；代理环境变量存在时仍直连回环
  - [x] 验证：`bats` 或等价测试通过；有/无本地服务两种场景真实运行

- [x] Task 2: 建立真实 provider 验收执行器
  - [x] 新增可选执行的真实集成测试（本地 OpenAI-compatible：模型发现/chat/embedding/STT/超时/取消/错误映射）
  - [x] 远程 GPU：voice enrollment / avatar enrollment / avatar stream 创建播放停止清理 / TTS / 幂等重试取消 / 远程资源清理
  - [x] 飞书：token 有效性、space 权限、Wiki/Docx 读取、增量同步、删除失效撤销、回答引用链接与片段真实可用
  - [x] 生命周期：对话断网恢复、构建断网恢复、Sidecar 崩溃恢复、GUI 重启恢复、旧库升级、迁移失败备份恢复
  - [x] 缺凭证项输出 UNVERIFIED（不标 PASS）；结果写机器可读 JSON + 人类可读 Markdown（时间/版本/commit/架构/证据）
  - [x] 验证：缺凭证时全部 UNVERIFIED 且非零/明确标记；合法本地服务时对应项通过

## 第二阶段：P0 正式发布闭环

- [x] Task 3: 签名 / 公证 / 安装闭环
  - [x] Developer ID Application 签名脚本；notarization + stapling；Gatekeeper 通过
  - [x] arm64 与 x86_64 双架构；干净 Mac 首次安装与相机/麦克风/Keychain 首次权限流程
  - [x] 真正断网启动；覆盖安装与旧数据升级；卸载与本地数据清理；崩溃后资源/Sidecar 清理
  - [x] 缺证书/无干净 Mac 时如实标 UNVERIFIED，不伪造通过
  - [x] 验证：`verify-release-readiness.sh` / `smoke-dmg.sh` 真实结果记录

- [x] Task 4: 安全签名应用更新机制
  - [x] 更新检查、下载进度、签名验证、更新失败恢复
  - [x] 数据库迁移前备份、回滚或保留旧版本的安全策略
  - [x] 稳定/测试双通道；缺签名公钥/更新端点时如实标注并给验收清单
  - [x] 验证：更新状态机/回滚单测；`docs/release-experience.md` 更新

## 第三阶段：P1 自然对话

- [x] Task 5: 自然对话状态机与打断
  - [x] 实现 `idle → listening → transcribing → thinking → speaking → interrupted/reconnecting/error` reducer 状态机（真实事件驱动，非固定 setTimeout）
  - [x] VAD 自动检测开始/结束说话；实时或分块 STT 展示可修正临时转写
  - [x] 用户说话打断数字人：取消真实 `generation_id` 的 LLM 生成、停止 TTS/音频播放与 avatar 后续动作；被取消任务不写入消息也不自动播放
  - [x] 麦克风回声消除/噪声抑制/自动增益；数字人说话时降低或暂停麦克风回采
  - [x] 弱网重连、超时、重试、纯文本降级；「按键说话」/「自然对话」切换；聆听/理解/思考/说话/重连状态展示
  - [x] 性能预算：说话→首字转写、停说→转写完成、提交→首 token、首 token→首段语音、音画同步偏差、打断→声音停止
  - [x] 验证：状态机测试、打断取消测试、弱网降级测试、性能指标记录（vitest conversation 118 通过、tsc 干净；后端 test_conversation.py 17 通过）

## 第四阶段：P1 数字人呈现

- [x] Task 6: 数字人呈现生命周期与降级
  - [x] 视频流/TTS/generation 统一生命周期；切换数字人或会话时停止旧音频/视频/网络任务
  - [x] stream loading/buffering/reconnecting/fallback 状态；流失败保留文字与音频不丢回答
  - [x] 静态人像降级：自然的说话/聆听/思考状态；provider 能力时音画同步/口型/情绪参数
  - [x] 页面隐藏、系统休眠、网络切换后正确恢复或重建流
  - [x] 验证：统一生命周期测试、降级保留测试、恢复测试

## 第五阶段：P1 首次使用门槛

- [x] Task 7: 配置向导与本地服务探测
  - [x] 自动探测 Ollama/LM Studio 等本地兼容服务；自动读取可用模型并下拉选择
  - [x] chat/embedding/STT 能力-模型匹配校验；技术错误翻译为用户可操作步骤
  - [x] 常见问题「一键重试/打开权限设置/重新授权/重新选择模型」
  - [x] 本地/远程数据范围说明；保存前校验、保存后真实验证；高级端点默认折叠
  - [x] 验证：向导单位测试、能力-模型校验测试

## 第六阶段：P1 知识与记忆深化

- [x] Task 8: 知识库体验
  - [x] 增量同步与同步进度；文档更新时间、新鲜度、失败原因
  - [x] 单文档启用/暂停/重同步/删除；引用显示标题/来源/更新时间/命中片段
  - [x] 无可靠依据回答标记「未使用知识库」；检索质量测试集（召回/引用正确性/无依据回答率）
  - [x] 验证：同步进度测试、引用展示测试、检索质量评估输出

- [x] Task 9: 长期记忆体验
  - [x] 每条记忆来源与创建时间；固定/编辑/删除/暂时禁用/「不再记住此类信息」
  - [x] 区分用户显式要求记忆 vs 系统自动摘要；按数字人/会话/全局限定作用域
  - [x] 注入前长度/冲突/重复/敏感信息检查；隐私说明与彻底删除验证
  - [x] 验证：记忆管理测试、注入前检查测试、删除验证测试

## 第七阶段：P1 可靠/可观测/无障碍

- [x] Task 10: 可观测性与诊断
  - [x] 结构化日志与 request_id 全链路关联；本地诊断包导出（默认脱敏）
  - [x] provider 延迟/错误率/取消率/降级率指标；Sidecar 崩溃/数据库迁移/媒体资源泄漏测试
  - [x] 长对话、大量会话、大量知识文档性能测试
  - [x] 遥测默认尊重隐私：未经明确同意不传对话文本/录音/照片/知识/记忆/密钥
  - [x] 验证：日志关联测试、诊断包脱敏测试、泄漏测试、性能测试（后端 21 项通过；前端 vitest 7 项、tsc 干净；Rust 20 项通过）

- [x] Task 11: 无障碍与全状态 UI
  - [x] 键盘完整操作；VoiceOver 标签与焦点管理；字幕与语音转写
  - [x] reduced motion、高对比度、字体缩放
  - [x] 所有错误/空状态/加载状态/恢复状态的 UI 测试
  - [x] 验证：无障碍测试、全状态 UI 测试

## 第八阶段：交付与验收

- [x] Task 12: 文档更新与全量回归
  - [x] 更新 `README.md`、`docs/development.md`、`docs/real-provider-acceptance.md`、`docs/release-checklists.md`、`docs/release-experience.md`
  - [x] 修复 provider 假阳性后重新生成所有 `output/*` 报告；PASS/FAIL/UNVERIFIED 与真实结果一致
  - [x] 全量测试通过（后端 pytest 432、前端 vitest 440、tsc、build、Rust fmt/clippy/test、migrations、mock smoke）
  - [x] 输出修改文件清单、架构/状态机说明、执行命令、测试结果、未验证项、需人工/凭证步骤
  - [x] 验证：全量门禁真实运行通过

# Task Dependencies
- [Task 1] 独立（最高优先）
- [Task 2] depends on [Task 1]（复用其结构化判定）
- [Task 3]/[Task 4] 独立（发布闭环，可与 P1 并行）
- [Task 5] depends on [Task 1]（弱网/中断判定复用）
- [Task 6] depends on [Task 5]（共享 generation 生命周期）
- [Task 7] 独立（配置向导）
- [Task 8]/[Task 9] 独立（知识/记忆）
- [Task 10]/[Task 11] 独立（可观测/无障碍）
- [Task 12] depends on 全部

## 并行可执行
- [Task 1]/[Task 3]/[Task 4]/[Task 7]/[Task 8]/[Task 9]/[Task 10]/[Task 11] 可并行
- [Task 2] depends on [Task 1]
- [Task 5]/[Task 6] 在 P0 后并行