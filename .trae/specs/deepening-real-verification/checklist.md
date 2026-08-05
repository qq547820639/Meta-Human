# Checklist

> 每个 checkpoint 以真实代码与可复现测试为依据，通过后打勾；未通过绝不勾选。

## P0 真实更新闭环
- [x] `tauri-plugin-updater` 依赖、`plugins.updater` 配置（stable/beta 双端点、公钥）已写入
- [x] updater 插件在 `lib.rs` 注册，check/download/install 命令真实存在
- [x] 升级前自动备份数据库；迁移失败回滚并保留旧版本与用户数据
- [x] Rust 单测覆盖配置解析、版本递增、无配置时 `configured=false`
- [x] 前端 `updateStateMachine` / `updateClient` 接入真实事件；未配置时如实显示「未配置」
- [x] ruff 与 mypy 已加入 dev 依赖、配置 `[tool.ruff]`/`[tool.mypy]`，CI 作为硬性 gate
- [x] 后端 ruff/mypy 全绿；`pytest` 全绿
- [x] release workflow 产出带版本、commit SHA、构建时间、checksums 的 provenance
- [x] 未签名/未公证/无端点/无密钥项如实标 `UNVERIFIED`，绝不伪造 PASS

## P0 provider 健康检查与契约
- [x] 适配器校验状态码/Content-Type/JSON 结构/关键字段；HTML/代理/空/错误 JSON 判失败
- [x] 分阶段超时、取消信号、仅幂等操作自动重试
- [x] 401/403/404/408/409/429/5xx/连接/DNS/证书 → 中文可执行提示
- [x] 测试连接结果展示地址/provider 类型/耗时/能力/未通过步骤
- [x] mock + contract 测试覆盖流式分片/超时/限流/乱序/非法结构/中途断开
- [x] `smoke-providers.sh` 无假阳性

## P1 自然对话
- [x] 流式 LLM→TTS 按句子/稳定语义片段切分下发
- [x] 播报期间识别抑制/回声判定；优先 AEC；不通过永久禁用插话规避
- [x] 语义分块与回声抑制的单测/集成测试通过

## P1 知识/记忆/隐私/UX
- [x] 同步阶段/进度/最近成功/新鲜度、失败文档与原因、单文档重试可用
- [x] “临时对话”模式不写长期记忆；删除对话说明是否删除派生记忆
- [x] 记忆条目：派生来源/编辑/删除/“不再记录”；区分模型答案/知识事实/记忆
- [x] 跟随系统深色/浅色模式
- [x] 错误提示“发生了什么/可能原因/下一步操作”结构
- [x] 破坏性操作二次确认/撤销

## 回归
- [x] 后端 pytest、前端 vitest、tsc、Rust fmt/clippy/test、构建全绿
- [x] CHANGELOG/文档/验收仅按真实实现与真实测试结果更新
- [x] 真实验收项、`UNVERIFIED` 项、已知风险已如实输出