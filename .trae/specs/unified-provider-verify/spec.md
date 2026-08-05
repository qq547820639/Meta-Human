# 统一 Provider 深度验证接口 Spec

## Why

基线审查（commit `85068c8`，macOS arm64，Rust 1.97 / uv 0.11.28 / node 26）显示全部 11 项
门禁真实通过（前端 471 测试、Rust clippy -D warnings、pytest 463、tsc、vite build、
cargo audit 0 漏洞等），仓库并非处于“失败候选版”。但审查同时确认存在一个**明确、
可验证的硬缺口**：后端没有统一的 `POST /v1/providers/verify` 深度验证端点。

当前前端 [providerVerify.ts](file:///Volumes/Extra/CodeProj/数字人/apps/desktop/src/features/settings/providerVerify.ts#L6-L11)
明确注释“sidecar 后端不暴露 settings-verification 端点”，因此真实验证的天花板只能是
`configured_unverified`；飞书验证也只检查本地是否已有同步记录，未做真实凭据/权限检查。
这正好对应需求 P0 第三部分。其余 P1/P2 项（音频生命周期、reply chunker、回声抑制、
VAD/STT、网络恢复、知识/记忆/隐私、首次使用/无障碍/性能）在既有 spec 中已有实质实现
并有通过的测试，本轮**不重复推行、不伪造完成**，仅维持其真实状态。

## What Changes

- **新增统一验证契约** `POST /v1/providers/verify`：一次请求返回某个 provider 的深度
  验证结构，包含 provider 类型、总体状态、当前验证步骤、endpoint、网络可达性、TLS 状态、
  身份认证状态、权限状态、API 版本兼容性、模型是否存在、模型能力、首次响应延迟、总耗时、
  可恢复错误、用户可理解处理建议、原始错误追踪 ID。
- **分类错误映射**：认证失败、权限不足、模型不存在、版本不兼容、服务限流**不再统一折叠为
  `network_unreachable`**，各自映射为独立状态码与可执行建议。
- **至少支持 7 类 provider**：Ollama、LM Studio、远程 GPU、飞书知识库、STT、TTS、LLM。
- **前端设置页实时展示**验证步骤、失败原因与可执行修复建议；接入真实结构替换
  `configured_unverified` 天花板。
- **飞书真实验证**：进行真实凭据与权限检查（调用飞书 API 获取 user/token 信息），不再只依赖
  本地是否已有同步记录。
- 复用既有 `capabilities` 适配器与 `knowledge/feishu.py` 的真实检查能力，不造重复轮子。

## Impact

- Affected specs: `deepening-real-verification`（新增契约端点）、`production-convergence`。
- Affected code:
  - 后端：`apps/sidecar/src/voxstudio_core/api/routes/providers.py`（新增）、
    `api/app.py`（注册路由）、`providers/verify.py`（新增验证服务与模型）。
  - 前端：`apps/desktop/src/features/settings/providerVerify.ts`、
    `features/settings/settingsClient.ts`、`features/settings/FeishuKnowledgePanel.tsx`、
    `features/settings/LocalModelPanel.tsx`、`features/settings/RemoteServicePanel.tsx`。
  - 测试：后端 `tests/integration/api/test_provider_verify.py`（新增）、
    `tests/unit/providers/test_verify.py`（新增，错误映射/竞态/超时）、
    前端 `providerVerify.test.ts`、`settingsClient.test.ts`。
  - 文档：`README.md`、`docs/api.md`（若有）、验收清单。

## ADDED Requirements

### Requirement: 统一 Provider 深度验证端点
系统 SHALL 提供 `POST /v1/providers/verify`，接受 `provider_type` 与可选配置，返回
`ProviderVerification` 结构。

#### Scenario: 验证本地 LLM（Ollama/LM Studio）
- **WHEN** 请求 `provider_type=ollama`（或 `lmstudio`）且服务可运行、模型存在
- **THEN** 返回 `status=ok`、当前步骤 `model_chat`、endpoint、网络可达、TLS/认证/权限
  通过、模型存在且能力含 `chat`、首次响应延迟与总耗时非负、无错误
- **WHEN** 模型不存在
- **THEN** 返回 `status=failed`、`error.code=model_not_found`、`recoverable=true`、
  建议“请检查模型名称或先拉取模型”，**不得**映射为 `network_unreachable`

#### Scenario: 远程 GPU 验证
- **WHEN** 请求 `provider_type=remote_gpu` 且可访问
- **THEN** 返回端到端串联验证（voice/avatar/TTS/stream）的整体状态与各步骤详情

#### Scenario: 飞书知识库真实凭据验证
- **WHEN** 请求 `provider_type=feishu`
- **THEN** 发起真实飞书 API 调用验证凭据与权限（token 有效、空间可访问），返回认证状态、
  权限状态与可执行建议；**不得**仅依据本地同步记录判定

### Requirement: 分类错误映射
系统 SHALL 区分 `invalid_credentials`、`insufficient_permission`、`model_not_found`、
`space_not_found`、`api_version_incompatible`、`provider_rate_limited`、
`provider_unavailable`、`network_unreachable` 等状态，并为每种给出用户可理解的中文建议。

#### Scenario: 认证失败
- **WHEN** provider 返回 401/403
- **THEN** `error.code=invalid_credentials`（或 `insufficient_permission`），
  `recoverable=true`，建议“请检查 API Key / 重新授权”，不折叠为网络不可达

### Requirement: 前端实时展示与修复建议
系统 SHALL 在前端设置页实时展示验证步骤、失败原因与可执行修复建议。

#### Scenario: 验证进行中/结束
- **WHEN** 用户在设置页点击“验证”
- **THEN** 前端展示当前步骤（connection → tls → auth → permission → model → capability →
  latency），完成后展示总体状态与每步详情/建议

## MODIFIED Requirements

### Requirement: 前端 Provider 验证状态（修改自 providerVerify.ts）
取代“后端无验证端点→天花板为 configured_unverified”的注释，改为调用真实
`POST /v1/providers/verify`；当端点或配置缺失时仍如实回退为 `unconfigured`，绝不伪造成功。

## REMOVED Requirements
无移除。