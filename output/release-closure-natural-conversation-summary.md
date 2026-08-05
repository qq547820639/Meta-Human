# 迭代总结：正式发布闭环 + 自然对话体验深化（Task 12 交付与验收）

- 基线 HEAD：`45dc2129f1965d8847f346001a7a5b27456b5c90`
- 生成时间：2026-08-05（本机，macOS，Apple Silicon）
- 迭代范围：P0（provider 假阳性修复 + 真实验收体系 + 发布闭环 + 安全更新）+ P1（自然对话、数字人呈现、配置向导、知识/记忆、可观测/诊断、无障碍/全状态 UI）+ Task 12（文档与全量回归）

> **结论统一表述：** 当前迭代已完成（代码、自动化测试、文档、可执行验收脚本均落地并通过全量回归），
> 但由于本地模型/远程 GPU/飞书/签名/公证/干净 Mac 等凭证与服务缺失，**产品仍未达到生产发布完成状态**。
> 发布前必须补齐这些外部依赖并按 `docs/real-provider-acceptance.md`、`docs/release-checklists.md` 逐项真实验收。

---

## 1. 修改文件清单

### P0 — provider 假阳性修复 + 真实验收体系 + 发布闭环 + 安全更新

| 文件 | 说明 |
| --- | --- |
| `scripts/smoke-providers.sh` | 重写：绕过代理（`--noproxy '*'`）、仅接受 2xx、校验 JSON、区分失败类型、结构化 PASS/FAIL/UNVERIFIED、无真实 provider 非零退出 |
| `scripts/test_smoke_providers.sh` | smoke-providers 回归测试 |
| `scripts/accept-providers/`（`accept_providers.py`、`common.py`、`local.py`、`remote.py`、`feishu.py`、`lifecycle.py`） | 真实 provider 验收执行器，缺凭证标 UNVERIFIED，输出 JSON + Markdown |
| `scripts/record-provider-acceptance.sh` | 运行执行器并写 `output/provider-acceptance.json` / `.md` |
| `scripts/record-provider-readiness.sh` | 写 `output/provider-readiness.md` |
| `scripts/sign-notarize.sh` | Developer ID 签名 + notarization + stapling 闭环（缺凭证标 UNVERIFIED） |
| `scripts/release-closure.sh` | 发布闭环：双架构、签名、spctl、staple、离线、覆盖/卸载/崩溃清理 |
| `scripts/test_release_closure.sh` | 发布闭环判定逻辑回归测试 |
| `scripts/verify-release-readiness.sh` / `record-release-readiness.sh` | 发布就绪检查 + 报告 |
| `scripts/record-dmg-smoke.sh` / `record-mock-smoke.sh` | DMG / mock 冒烟报告 |
| `apps/desktop/src-tauri/src/updater.rs` | 更新配置读取（公钥/端点/通道），`configured` 如实上报 |
| `apps/desktop/src/features/update/`（`updateStateMachine.ts`、`signatureVerification.ts`、`UpdatePanel.tsx`、`updateClient.ts`、`useUpdateManager.ts`） | 签名应用更新生命周期 + 状态机 + UI + 单测 |
| `apps/sidecar/src/voxstudio_core/persistence/database.py` | 迁移前自动备份（`.bak.<版本>`） |
| `apps/sidecar/src/voxstudio_core/persistence/migrations/014_knowledge_doc_state.sql`、`015_memory_management.sql` | 见 §3 |

### P1 — 自然对话

| 文件 | 说明 |
| --- | --- |
| `apps/desktop/src/features/conversation/natural/naturalConversationStateMachine.ts` | `idle→listening→transcribing→thinking→speaking→interrupted/reconnecting/error` 事件驱动 reducer |
| `apps/desktop/src/features/conversation/natural/naturalConversationCore.ts` | 自然对话核心逻辑（与 UI 解耦） |
| `apps/desktop/src/features/conversation/natural/vad.ts`、`vadAdapter.ts`、`stt.ts` | VAD 检测、分块 STT 临时转写 |
| `apps/desktop/src/features/conversation/useNaturalConversation.ts` | 自然对话 hook 接线 |
| `apps/desktop/src/features/conversation/NaturalConversationBar.tsx` | 自然对话状态栏 UI |
| 相关单测：`naturalConversationStateMachine.test.ts`、`naturalConversationCore.test.ts`、`vad.test.ts`、`NaturalConversationBar.test.tsx` | 状态机/打断/降级测试 |

### P1 — 数字人呈现生命周期

| 文件 | 说明 |
| --- | --- |
| `apps/desktop/src/features/conversation/avatarPresentationLifecycle.ts` | 视频流/TTS/generation 统一生命周期 |
| `apps/desktop/src/features/conversation/useAvatarPresentation.ts` | 生命周期接线到对话 UI |
| 删除 `useAvatarSession.ts`（被上述替代） | 统一管理 |
| 单测：`avatarPresentationLifecycle.test.ts`、`useAvatarPresentation.test.tsx` | 统一生命周期/降级/恢复 |

### P1 — 配置向导

| 文件 | 说明 |
| --- | --- |
| `apps/desktop/src/features/settings/`（`localProbe.ts`、`modelCapability.ts`、`providerVerify.ts`、`errorTranslation.ts`、`Settings.tsx`、`settingsClient.ts` 等） | 本地服务自动探测、模型下拉、能力-模型匹配、错误翻译、一键检查 |
| 单测：`localProbe.test.ts`、`modelCapability.test.ts`、`providerVerify.test.ts`、`errorTranslation.test.ts`、`Settings.test.tsx` | 向导/校验测试 |

### P1 — 知识与记忆

| 文件 | 说明 |
| --- | --- |
| `apps/sidecar/src/voxstudio_core/knowledge/`（`sync.py`、`sources.py`、`retrieval.py`、`memory.py`、`memory_rules.py`、`history.py`） | 增量同步、单文档管理、注入前检查、记忆规则 |
| `apps/sidecar/src/voxstudio_core/persistence/migrations/014`、`015` | 文档状态列 + 记忆来源/作用域/固定/忽略规则 |
| `apps/desktop/src/features/knowledge/knowledgeClient.ts`、`features/memory/memoryClient.ts` | 前端客户端 |
| 单测：`test_sync.py`、`test_sources.py`、`test_memory.py`、`test_memory_service.py`、`test_memory_rules.py`、`test_memory_management_migration.py`、`knowledgeClient.test.ts`、`memoryClient.test.ts` | 知识/记忆测试 |

### P1 — 可观测与诊断

| 文件 | 说明 |
| --- | --- |
| `apps/sidecar/src/voxstudio_core/telemetry.py`、`metrics.py`、`api/routes/metrics.py` | request_id 全链路、provider 指标 |
| `apps/sidecar/tests/integration/api/test_request_id_linkchain.py`、`test_metrics_api.py`、`unit/test_provider_metrics.py`、`unit/persistence/test_performance.py` | 日志关联/指标/泄漏/性能测试 |
| `apps/desktop/src/features/diagnostics/metricsClient.ts`、`DiagnosticsPanel.tsx`、`diagnosticReport.ts` | 诊断面板 + 脱敏报告导出 |
| `apps/desktop/src-tauri/src/sidecar.rs`、`tests/sidecar_supervisor.rs` | 崩溃诊断/重启预算/fail-closed |
| `apps/desktop/src-tauri/tests/media_leak_contract.rs` | 临时媒体泄漏测试（本次修正 fmt + clippy） |

### P1 — 无障碍与全状态 UI

| 文件 | 说明 |
| --- | --- |
| `apps/desktop/src/features/conversation/accessibility.test.tsx`、`ui/accessibility.css`、`features/settings/stateUI.test.tsx` | 键盘/VoiceOver/reduced-motion/全状态 UI 测试 |

### Task 12 — 文档与 output

| 文件 | 说明 |
| --- | --- |
| `README.md` | 补充本迭代能力、自然对话、UNVERIFIED 声明、真实验收执行器 |
| `docs/development.md` | 自然对话状态机、数字人呈现生命周期、request_id/指标、验收执行器 |
| `docs/real-provider-acceptance.md` | 引用可执行验收执行器、缺凭证语义、假阳性已修复说明 |
| `output/provider-readiness.md`、`provider-acceptance.json`/`.md`、`release-readiness.md`、`dmg-smoke.md`、`mock-provider-smoke.md`、`release-closure.md`、`release-sign-notarize.md` | 按真实结果重新生成 |
| `output/release-acceptance.md` | 补充更新注记（假阳性已修复） |
| `output/release-closure-natural-conversation-summary.md` | 本文档 |

---

## 2. 架构与状态机说明

### 2.1 自然对话状态机

`naturalConversationStateMachine.ts` 用纯 reducer 建模，真实事件驱动（非固定 `setTimeout`）：

```
idle → listening → transcribing → thinking → speaking → interrupted / reconnecting / error
```

- **VAD** 检测说话开始/结束，分块 STT 展示可修正临时转写。
- **打断**：数字人 `speaking` 时用户开口 → 取消真实 `generation_id` 的 LLM 生成、停止 TTS/音频/avatar 后续动作；被取消任务不写入消息、不自动播放。
- **降级**：弱网重连、超时重试、纯文本降级（`按键说话` / `自然对话` 可切换）。
- **回声处理**：数字人说话时降低麦克风回采（回声消除/降噪/自动增益）。
- **性能预算**：说话→首字转写、停说→转写完成、提交→首 token、首 token→首段语音、音画同步偏差、打断→声音停止。

### 2.2 数字人呈现生命周期

`avatarPresentationLifecycle.ts` 统一管理视频流 / TTS / generation 生命周期，切换数字人或会话时先停止旧音频/视频/网络任务：

- stream 状态 `loading / buffering / reconnecting / fallback`，失败保留文字与音频。
- 静态人像降级：自然说话/聆听/思考状态。
- 页面隐藏、系统休眠、网络切换后正确恢复或重建流。

### 2.3 更新状态机

`updateStateMachine.ts`：`idle → checking → available → downloading(进度) → verifying_signature → ready → installing → idle`，及 `error / rolled_back` 恢复分支。`INSTALL_START` 仅在签名验证通过后允许；篡改签名落入 `error` 且不可重试。双通道 `stable / beta`。缺公钥/端点时 `configured=false`，UI 显示「未配置」。

---

## 3. 数据库 / API 契约变化

新增迁移（`apps/sidecar/src/voxstudio_core/persistence/migrations/`）：

- `014_knowledge_doc_state.sql`：`knowledge_documents` 增加 `enabled`、`status`、`last_error`、`sync_stage`、`sync_progress`、`sync_started_at`、`sync_finished_at`（单文档启停/同步进度/失败原因），`user_version = 14`。
- `015_memory_management.sql`：`memory_entries` 增加 `source`（user/system）、`scope`、`scope_id`、`pinned`、`disabled`；新增 `memory_ignore_rules` 表（「不再记住此类信息」规则）；回填 `source = 'user' where type = 'explicit_request'`，`user_version = 15`。
- 迁移前自动备份：`migrate()` 在存在待执行迁移且库含应用表时，先复制为 `<name>.bak.<目标版本>`。

API 契约变化：

- `GET /v1/metrics`：provider 延迟/错误率/取消率/降级率指标。
- `request_id` 全链路关联（日志 + 响应头），见 `test_request_id_linkchain.py`。

---

## 4. 执行过的命令与真实结果

| 命令 | 结果 |
| --- | --- |
| `uv run --project apps/sidecar pytest apps/sidecar/tests --strict-markers --strict-config -q` | **432 passed**（2 warnings，8.37s） |
| `pnpm --dir apps/desktop exec tsc --noEmit` | **通过**（exit 0） |
| `pnpm --dir apps/desktop exec vitest run` | **51 files / 440 passed**（含 real-Sidecar E2E `sidecar.e2e.test.ts` 10 例，本次并行下通过） |
| `pnpm --dir apps/desktop build`（tsc + vite build） | **通过**（dist 产物生成） |
| `cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check` | **通过**（修复 `media_leak_contract.rs` 格式后） |
| `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` | **通过**（修复 `&PathBuf → &Path` 后） |
| `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` | **通过**（含 sidecar_supervisor 17 例等全部测试） |
| `scripts/verify-foundation.sh` | **PASSED**（全部门禁通过） |
| `scripts/smoke-providers.sh` | `0 PASS, 1 FAIL, 3 UNVERIFIED`，exit 1（无假阳性） |
| `scripts/record-provider-readiness.sh` | 写 `output/provider-readiness.md` |
| `scripts/record-provider-acceptance.sh` | 写 `provider-acceptance.json`/`.md`：26 项 = 6 PASS + 1 FAIL + 19 UNVERIFIED；executor exit 1（因 FAIL） |
| `scripts/verify-release-readiness.sh` | 4 PASS（sidecar/universal×2/tools），2 FAIL（credentials、identity），exit 1 |
| `scripts/record-release-readiness.sh` | 写 `output/release-readiness.md` |
| `scripts/smoke-dmg.sh` | **全部 PASS**（DMG 校验/双架构/签名/启动/退出） |
| `scripts/record-dmg-smoke.sh` | 写 `output/dmg-smoke.md` |
| `scripts/sign-notarize.sh` | 2 UNVERIFIED(identity/notary) + 2 FAIL(adhoc/spctl)，exit（缺凭证） |
| `scripts/release-closure.sh` | 8 PASS + 2 FAIL(签名/spctl) + 5 UNVERIFIED |
| `scripts/test_release_closure.sh` | **13 passed** |
| `scripts/test_smoke_providers.sh` | **All smoke-providers tests PASSED** |
| `uv run --project apps/sidecar python scripts/smoke-mock-provider.py` | mock 端到端全通过（healthz/start/readyz/conversation/…/memory_delete） |
| `scripts/record-mock-smoke.sh` | 写 `output/mock-provider-smoke.md` |

---

## 5. 测试结果汇总

| 套件 | 结果 | 说明 |
| --- | --- | --- |
| 后端 pytest | **432 passed** | 单元 + 集成 + 迁移 + 性能 + 指标 |
| 前端 vitest | **440 passed / 51 files** | 含状态机/打断/无障碍/全状态 UI；real-Sidecar E2E 本次通过（并行下偶发端口冲突，需独立跑或单独记录） |
| 前端 tsc | 通过 | 类型干净 |
| 前端 build | 通过 | vite build |
| Rust fmt | 通过 | 2 处修复 |
| Rust clippy | 通过 | 1 处修复（`&PathBuf`） |
| Rust test | 通过 | supervisor 17 例 + 其余契约测试 |
| smoke-providers | 无假阳性 | 0 PASS / 1 FAIL / 3 UNVERIFIED |
| smoke-mock-provider | 全通过 | 15 项端到端 |
| smoke-dmg | 全通过 | 本机 ad-hoc 签名产物 |
| release-closure / sign-notarize | 缺凭证 UNVERIFIED + FAIL | 见下 |

---

## 6. 仍未验证的项目（缺凭证 / 服务 / 硬件）

| 项 | 缺什么 | 当前状态 |
| --- | --- | --- |
| 本地模型服务 | Ollama/LM Studio 等（127.0.0.1:11434 无服务） | FAIL（连接拒绝，非假阳性） |
| 远程 GPU（数字人/TTS/形象流） | `VOXSTUDIO_REMOTE_BASE_URL` / `API_KEY` | UNVERIFIED |
| 飞书知识 | `VOXSTUDIO_FEISHU_*` 凭证 | UNVERIFIED |
| 真实 TTS / 真实数字人 | 远程 GPU provider | UNVERIFIED |
| Apple Developer ID 签名 | Developer ID Application 证书（本机 0 有效身份） | UNVERIFIED + FAIL(adhoc/spctl) |
| notarization / stapling | `APPLE_TEAM_ID` + 三个 notary 凭证 | UNVERIFIED |
| 干净 Mac 安装 / 首次权限 | 干净 Mac + 真实 TCC 交互 | UNVERIFIED |
| 断网启动 / 覆盖升级 / 卸载 / 崩溃清理 | 真实安装环境 / 免密 sudo | UNVERIFIED |
| 签名应用更新（真实端点） | 更新端点 + 签名公钥 | UNVERIFIED（生命周期/签名验证代码与单测已落地） |

---

## 7. 需要人工或外部凭证完成的步骤

1. 启动本地 OpenAI 兼容服务（Ollama/LM Studio），或提供 `VOXSTUDIO_LOCAL_BASE_URL` 等。
2. 提供远程 GPU 服务地址与 API Key（`VOXSTUDIO_REMOTE_*`）。
3. 提供飞书应用凭证与用户 token（`VOXSTUDIO_FEISHU_*`）。
4. 安装 Developer ID Application 证书到登录钥匙串（`security import <cert>.p12`）。
5. 配置 notary 凭证（`APPLE_TEAM_ID`、`APPLE_NOTARY_API_KEY`、`APPLE_NOTARY_KEY_ID`、`APPLE_NOTARY_ISSUER`）。
6. 提供干净 Mac 测试机，执行首次权限 / 断网 / 覆盖 / 卸载 / 崩溃清理验收。
7. 生成更新签名密钥对、部署更新清单端点，接入真实 `tauri-plugin-updater`。

补齐后按 `docs/real-provider-acceptance.md`、`docs/release-checklists.md`、`docs/release-experience.md` 的 runbook 逐项执行，并重新运行 `scripts/record-provider-acceptance.sh`、`scripts/release-closure.sh`、`scripts/sign-notarize.sh` 生成真实证据。

---

## 8. 完成表

| 类别 | 项 | 状态 |
| --- | --- | --- |
| P0 | provider 假阳性修复 + 测试 | ✅ 完成并验证 |
| P0 | 真实 provider 验收执行器（JSON+MD） | ✅ 完成并验证（缺凭证 UNVERIFIED、无假阳性） |
| P0 | 签名/公证/安装闭环脚本 | ✅ 脚本完成；⚠️ 缺凭证 UNVERIFIED |
| P0 | 安全签名应用更新机制 | ✅ 生命周期/签名代码+单测完成；⚠️ 真实端点未配置 |
| P1 | 自然对话状态机与打断 | ✅ 完成并验证 |
| P1 | 数字人呈现生命周期 | ✅ 完成并验证 |
| P1 | 配置向导 | ✅ 完成并验证 |
| P1 | 知识库体验 | ✅ 完成并验证（本地测试） |
| P1 | 长期记忆体验 | ✅ 完成并验证（本地测试） |
| P1 | 可观测与诊断 | ✅ 完成并验证 |
| P1 | 无障碍与全状态 UI | ✅ 完成并验证 |
| 交付 | 文档更新 | ✅ 完成 |
| 交付 | output 报告重新生成 | ✅ 完成（与真实结果一致） |
| 交付 | 全量回归 | ✅ 全部通过 |

---

## 9. 结论

**当前迭代已完成，但产品仍未达到生产发布完成状态。** 代码、自动化测试、文档与可执行验收脚本均已落地并通过全量回归（后端 432、前端 440、Rust 全绿、smoke 无假阳性）；但由于本地模型/远程 GPU/飞书/签名/公证/干净 Mac 等关键外部依赖缺失，真实 provider 验收、Developer ID 签名、notarization 与干净安装闭环均未完成。补齐凭证与服务后，按下述 runbook 执行并生成真实证据方可达到生产发布完成状态。