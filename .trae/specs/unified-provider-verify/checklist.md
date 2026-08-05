# Checklist

> 每个 checkpoint 以真实代码与可复现测试为依据，通过后打勾；未通过绝不勾选。

## 后端统一验证契约
- [x] `providers/verify.py` 定义 `ProviderVerification`/`VerifyStep`/`VerifyError` 及
  `ProviderVerifyRequest`，含全部要求字段（provider_type/status/current_step/endpoint/
  network_reachable/tls_status/auth_status/permission_status/api_version_compatible/
  model_exists/model_capabilities/first_response_latency_ms/total_duration_ms/recoverable/
  recommended_action/error_trace_id）
- [x] 逐步验证执行器按 connection→tls→auth→permission→model→capability→latency 逐步执行，
  每步记录耗时与状态
- [x] 分类错误映射：401/403/404/429/版本不兼容不被折叠为 network_unreachable
- [x] 支持 Ollama、LM Studio、远程 GPU、飞书知识库、STT、TTS、LLM 七类 provider
- [x] 飞书验证发起真实凭据/权限/空间访问检查，不依赖本地同步记录
- [x] `POST /v1/providers/verify` 已注册并受 BearerTokenGuard 保护，返回含错误追踪 ID

## 前端接入
- [x] `settingsClient.ts` 新增 `verifyProviderDeep` 调用真实端点
- [x] `providerVerify.ts` 端点可用时返回真实状态，无配置时如实 `unconfigured`
- [x] 设置页实时展示当前步骤、失败原因、可执行建议

## 测试
- [x] 后端单元测试覆盖错误映射/超时/竞态/部分成功
- [x] 后端集成测试覆盖 7 类 provider 的 mock 成功与失败路径
- [x] 前端测试覆盖真实端点响应映射与回退

## 门禁与交付
- [x] pytest、ruff、mypy 全绿
- [x] vitest、tsc、vite build 全绿
- [x] cargo fmt、clippy -D warnings、cargo test 全绿
- [x] cargo audit 无新增高风险漏洞
- [x] 同一 commit SHA 重跑核心门禁仍通过
- [x] README/验收清单如实标注：verify 端点已实现；真实外部服务（远程 GPU/飞书/签名/公证）仍 UNVERIFIED
- [x] 代码已提交并推送 origin/main