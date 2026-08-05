# Tasks

> 以真实代码为准；每完成一个模块运行对应测试并立即修复回归。凭证/硬件/签名缺失的项目如实标 `UNVERIFIED`，绝不伪造 PASS。

## 第一阶段：P0 真实更新闭环

- [x] Task 1: 正式接入 Tauri updater 插件
  - [x] 在 `apps/desktop/src-tauri/Cargo.toml` 加入 `tauri-plugin-updater` 依赖
  - [x] 在 `tauri.conf.json` 写入 `plugins.updater`（`pubkey` 来自环境变量注入，stable/beta 双端点）
  - [x] 在 `src/lib.rs` 注册 updater 插件并暴露 check/download/install 命令
  - [x] 更新 `src/updater.rs`：从“仅上报配置”改为驱动真实插件事件，保留未配置时的如实上报
  - [x] 升级前自动备份数据库；迁移失败回滚并保留旧版本与用户数据
  - [x] Rust 单测：配置解析、版本递增校验、无配置时 `configured=false`
  - [x] 前端 `updateStateMachine` 接入真实事件而非仅模拟；`updateClient` 调用真实命令
  - [x] 验证：`cargo test`、前端 vitest 更新相关用例；真实端点/签名缺失项标 `UNVERIFIED`

- [x] Task 2: ruff + mypy 正式成为 CI 质量门禁
  - [x] 将 `ruff`、`mypy` 加入 `apps/sidecar/pyproject.toml` dev 依赖
  - [x] 写入 `[tool.ruff]` 与 `[tool.mypy]` 配置
  - [x] CI（`.github/workflows/ci.yml`）中作为硬性 gate 运行 `ruff check` 与 `mypy`
  - [x] 修复后端全部 ruff/mypy 违规
  - [x] 验证：本机 `ruff check`、`mypy`、`pytest` 全绿

- [x] Task 3: 启用真实 release workflow 与产物溯源
  - [x] `release-gate` 从 `if: false` 空操作改为真实发布步骤
  - [x] 生成产物 provenance：版本、commit SHA、构建时间、各产物 sha256 校验值
  - [x] 更新 `scripts/release-*.sh` 与 `docs/release-experience.md`
  - [x] 验证：脚本产出 checksums 清单；未签名/未公证项标 `UNVERIFIED`

## 第二阶段：P0 provider 健康检查结构与契约测试

- [x] Task 4: 健康检查响应结构校验 + contract 测试
  - [x] 本地/远程/OpenAI-compatible 适配器校验 HTTP 状态码、Content-Type、JSON 结构、关键字段
  - [x] HTML 页面、代理返回页、空响应、错误 JSON 一律判失败并给中文/可执行提示
  - [x] 分阶段超时、取消信号、仅幂等操作自动重试
  - [x] 401/403/404/408/409/429/5xx/连接失败/DNS/证书错误 → 中文可执行提示
  - [x] 测试连接结果展示：连接地址、provider 类型、响应耗时、检测能力、未通过步骤
  - [x] mock + contract 测试覆盖：流式分片、超时、限流、乱序、非法结构、中途断开
  - [x] 验证：新增 contract 测试通过；`smoke-providers.sh` 无假阳性

## 第三阶段：P1 自然对话深化

- [x] Task 5: 流式语义分块 + 回声抑制
  - [x] 流式 LLM→TTS 按句子/稳定语义片段切分下发，避免等全文
  - [x] 播报期间识别抑制/回声判定；优先系统 AEC；不通过永久禁用插话规避
  - [x] 补充语义分块与回声抑制的单测、集成测试
  - [x] 验证：vitest、tsc 干净

## 第四阶段：P1 知识/记忆/隐私/UX

- [x] Task 6: 知识/记忆体验闭环
  - [x] 确认并补齐：同步阶段/进度/最近成功/新鲜度、失败文档与原因、单文档重试
  - [x] “临时对话”模式（不写长期记忆）；删除对话时说明是否删除派生记忆
  - [x] 记忆条目：派生来源、编辑、删除、“不再记录”；区分模型答案/知识事实/记忆
  - [x] 补齐缺失的 contract 测试
  - [x] 验证：后端 pytest、前端 vitest

- [x] Task 7: 隐私与 UX 深化
  - [x] 跟随系统深色/浅色模式
  - [x] 错误提示统一“发生了什么/可能原因/下一步操作”结构
  - [x] 破坏性操作二次确认/撤销
  - [x] 验证：前端 vitest、tsc

## 第五阶段：文档与全量回归

- [x] Task 8: CHANGELOG、验收文档、用户文档与全量回归
  - [x] 仅按真实实现与真实测试结果更新 `CHANGELOG.md`、`docs/*`、`output/*`
  - [x] 运行后端 pytest、前端 vitest、tsc、Rust fmt/clippy/test、ruff、mypy、构建
  - [x] 输出真实验收项、`UNVERIFIED` 项、已知风险

# Task Dependencies
- [Task 1] 独立（P0 最高优先）
- [Task 2] 独立（可与 Task 1 并行）
- [Task 3] depends on [Task 1]（复用发布配置）
- [Task 4] 独立（provider 可靠性）
- [Task 5] depends on [Task 4]（复用弱网/中断判定）
- [Task 6] 独立
- [Task 7] 独立
- [Task 8] depends on 全部

## 并行可执行
- [Task 1]/[Task 2]/[Task 4]/[Task 6]/[Task 7] 可并行
- [Task 3] depends on [Task 1]
- [Task 5] depends on [Task 4]
- [Task 8] depends on 全部