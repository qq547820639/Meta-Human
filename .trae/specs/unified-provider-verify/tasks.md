# Tasks

## 阶段一：后端统一验证契约

- [x] Task 1: 新增验证领域模型与服务 `providers/verify.py`
  - [x] 定义 `ProviderVerification` / `VerifyStep` / `VerifyError` Pydantic 模型（含
    provider_type、status、current_step、endpoint、network_reachable、tls_status、
    auth_status、permission_status、api_version_compatible、model_exists、model_capabilities、
    first_response_latency_ms、total_duration_ms、recoverable、recommended_action、error_trace_id、
    steps 列表）
  - [x] 定义 `ProviderVerifyRequest`（provider_type + 可选 endpoint/api_key/model/space_id 等）
  - [x] 实现逐步验证执行器：connection → tls → auth → permission → model → capability → latency，
    每步独立记录耗时与状态，任何一步失败即停止并保留已通过步骤
  - [x] 实现分类错误映射（拒绝把 401/403/404/429/版本不兼容折叠为 network_unreachable）

- [x] Task 2: 实现 7 类 provider 验证适配器
  - [x] Ollama / LM Studio（本地 LLM）：复用 `OpenAICompatibleClient`，校验模型存在与 chat 能力
  - [x] 远程 GPU：串联 voice/avatar/TTS/stream 验证，复用 `RemoteGpuClient` 与既有远程适配器
  - [x] 飞书知识库：真实调用飞书 API 验证凭据/权限/空间可访问（复用 `FeishuClient`），
    不依赖本地同步记录
  - [x] STT、TTS、LLM：分别复用 `LocalSttAdapter`/`RemoteTtsAdapter`/`LocalChatAdapter` 的真实检查

- [x] Task 3: 注册 `POST /v1/providers/verify` 路由
  - [x] 新增 `api/routes/providers.py`，在 `create_app` 中注册（受 BearerTokenGuard 保护）
  - [x] 返回结构含原始错误追踪 ID（复用 `request_id` 链路）

## 阶段二：前端接入真实验证

- [x] Task 4: 前端调用真实 verify 端点
  - [x] `settingsClient.ts` 新增 `verifyProviderDeep` 调用 `POST /v1/providers/verify`
  - [x] `providerVerify.ts` 更新注释与回退逻辑：端点可用时返回真实状态，无配置时如实 `unconfigured`
  - [x] 设置页（LocalModelPanel / RemoteServicePanel / FeishuKnowledgePanel）实时展示
    当前步骤、失败原因、可执行建议

## 阶段三：测试与验证

- [x] Task 5: 后端测试
  - [x] 单元测试：`tests/unit/providers/test_verify.py` 覆盖错误映射、超时、竞态、部分成功
  - [x] 集成测试：`tests/integration/api/test_provider_verify.py` 覆盖 7 类 provider 的
    mock 成功/失败路径、认证失败、模型不存在、版本不兼容、限流
- [x] Task 6: 前端测试
  - [x] `providerVerify.test.ts` 覆盖真实端点响应映射与回退
  - [x] `settingsClient.test.ts` 覆盖 verify 请求契约与错误处理

## 阶段四：文档与交付

- [x] Task 7: 更新文档与验收
  - [x] 更新 README / 验收清单，标注统一 verify 端点已实现、真实外部服务仍 UNVERIFIED
  - [x] 运行全部门禁（pytest、ruff、mypy、vitest、tsc、clippy、fmt、cargo test、cargo audit、build）
  - [x] 对同一 commit SHA 重跑核心门禁确认稳定
  - [x] 提交并推送 origin/main

# Task Dependencies
- [Task 1] 独立（先定义模型与服务）
- [Task 2] depends on [Task 1]
- [Task 3] depends on [Task 2]
- [Task 4] depends on [Task 3]
- [Task 5] depends on [Task 1]/[Task 2]/[Task 3]
- [Task 6] depends on [Task 4]
- [Task 7] depends on 全部

## 并行可执行
- [Task 5] 的单元测试可与 [Task 2] 并行编写
- [Task 6] 可在 [Task 4] 完成后并行