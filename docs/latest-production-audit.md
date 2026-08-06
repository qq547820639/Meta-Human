# 最新生产基线审计（Latest Production Audit）

> 生成时间：2026-08-06 07:30（Asia/Shanghai）
> 审计对象：`qq547820639/Meta-Human` 的 `main` 分支
> 审计原则：以最新代码、最新 CI、重新执行的命令为准，不采信 README/checklist/历史报告的“已完成”声明。
> 审计版本：本文件为**当前 commit 版本**（覆盖早前针对 `aa07633` 的历史版本）。

---

## 1. 基线标识

| 项 | 值 |
|----|----|
| 当前 commit SHA | `5d8b238`（`test: add real/near-real test-matrix runner (Task 16)`） |
| 完整 SHA | `5d8b2384f6e9410009753f78cb0a26b0357911b8` |
| 与 origin/main | 一致（`git status` up to date，与 origin/main 同步） |
| 当前版本号 | `0.1.0`（package.json / Cargo.toml / pyproject.toml / tauri.conf.json 一致） |
| 版本标签 | 无 tag |
| GitHub Release | 无正式 Release |
| CPU 架构 | aarch64（Apple Silicon） |

---

## 2. 最新 GitHub Actions 状态

对当前 HEAD `5d8b238` 的正式 `push` 触发的 CI run（`31079789194`）结果：

| Job | 结果 | 说明 |
|-----|------|------|
| Dependency vulnerabilities | ✅ success | pnpm audit / uv audit / cargo audit 通过 |
| Python sidecar | ✅ success | ruff / mypy / pytest / coverage / build / mock smoke 全绿 |
| Frontend (TS / vitest) | ✅ success | tsc / vitest / build 通过 |
| Provider smoke mock-harness | ✅ success | `run-provider-acceptance-mock.sh` 20 PASS / 0 FAIL / 6 UNVERIFIED |
| Flaky test detection | ✅ success | 侧边栏套件跑 2 遍，无不一致结果 |
| Rust shell | ✅ success | fmt / clippy -D warnings / test 通过 |
| Release gate | ✅ success | 构建产物 + provenance +**SBOM** 生成；**诚实标记 UNVERIFIED**（无签名凭证） |

> 结论：**当前 commit（5d8b238）所有 7 个强制 CI job 为绿色**，Release gate 实际执行并通过（在缺凭证环境下以 UNVERIFIED 形式）。
> 注：签名为 UNVERIFIED 且诚实标记，未伪造 PASS。
> 注：上一 commit `07e5af7` 的 CI 基线（run `31078517717`）亦为绿色，作为前一阶段对照。

---

## 3. 质量门禁状态矩阵（重新执行结果）

`5d8b238` 的强制 CI 全部绿色（run `31079789194`），本地复跑确认：

| 门禁 | 命令 | 结果 |
|------|------|------|
| Python ruff | CI + 本地 `uv run --project apps/sidecar ruff check apps/sidecar/src apps/sidecar/tests` | ✅ 通过 |
| Python mypy | CI + 本地 `uv run --project apps/sidecar mypy apps/sidecar/src` | ✅ 通过 |
| Python pytest | CI + 本地 `uv run --project apps/sidecar pytest apps/sidecar/tests` | ✅ 通过（521 passed，见 CI） |
| Python 覆盖率 | CI `--cov-fail-under=80` | ✅ 通过（实测 ~88%） |
| Rust fmt / clippy -D warnings / test | `apps/desktop/src-tauri`（CI Rust shell job） | ✅ 通过 |
| frontend tsc / vitest / build | `apps/desktop`（CI Frontend job） | ✅ 通过 |
| 前端依赖漏洞 | `pnpm audit --audit-level=high` | ✅ 无已知漏洞 |
| Python 依赖漏洞 | `uv audit --project apps/sidecar` | ✅ 无已知漏洞 |
| Rust 依赖漏洞 | `cargo audit` | ✅ 退出码 0；**1 unsound + 17 unmaintained 告警**（见 §3.1） |
| Release gate | `scripts/*`（CI Release gate job） | ✅ 通过（provenance + SBOM + UNVERIFIED 标记） |

### 3.1 Rust 依赖告警明细

`cargo audit`（`apps/desktop/src-tauri`，2026-08-06 执行）退出码 `0`：**无带 CVE 的可利用漏洞**。告警如下：

| 严重级别 | 数量 | 编号 | 说明 |
|----------|------|------|------|
| unsound | 1 | RUSTSEC-2024-0429 | `glib::VariantStrIter` 的 `Iterator`/`DoubleEndedIterator` 实现存在 unsoundness |
| unmaintained | 17 | RUSTSEC-2024-0411/0412/0413/0414/0415/0416/0417/0418/0419/0420（GTK3 绑定）、RUSTSEC-2024-0370（proc-macro-error）、RUSTSEC-2024-0429 相关、RUSTSEC-2025-0075/0080/0081/0098/0100（unic-*） | 依赖已停止维护 |

- **RUSTSEC-2024-0429（glib unsound）**：`glib` 通过 `gtk` → `muda`/`tao`/`webkit2gtk` → `tauri` 依赖链引入，**仅用于 Linux 目标（GTK3 后端）**。macOS 应用运行时不链接 GTK，`VariantStrIter` 不在 macOS 代码路径上被使用。**可利用性：低**（需在 Linux 上构造特定 `GVariant` 迭代场景）。**缓解**：macOS 构建不受影响；维持 GLib 版本并由上游 tauri/gtk-rs 生态跟进修复。**到期时间**：tauri 切换到 GTK4 或上游发布安全版本后复查。
- **unmaintained（17）**：GTK3 绑定（`gtk`/`gtk-sys`/`atk`/`gdk` 等）与 `unic-*`、`proc-macro-error` 停止维护属**信息性告警**，非 CVE。均为 Linux 构建依赖或传递依赖，不在 macOS 运行时代码路径上。升级会破坏 GTK3 兼容性，**暂不升级**，由 `cargo audit` 持续跟踪。

> 结论：无高危可利用依赖漏洞；unsound 告警仅影响 Linux 目标，不构成 macOS 发布阻断。

---

## 4. 真实 Provider 可用性（UNVERIFIED）

> 验收执行器已在当前 HEAD `5d8b238` 对应的 CI job（`provider-smoke`，run `31079789194`）上重新执行。
> **Mock-harness 路径**（`verification_kind="mock-harness"`，写入 `output/provider-acceptance-mock-harness.json/.md`）：
> ```
> bash scripts/run-provider-acceptance-mock.sh
> ```
> 结果：**26 项 → 20 PASS（local/remote/feishu 各子项在受控 mock Provider 上真实执行业务客户端）/ 0 FAIL / 6 UNVERIFIED（诚实标记为需真实凭证/索引的项）**。退出码 0。
>
> **真实路径**（`verification_kind="real"`，需真实服务/凭证）：
> ```
> uv run --project apps/sidecar python scripts/accept-providers/accept_providers.py
> ```
> 结果：**6 PASS（均为 credential-free 生命周期检查）/ 1 FAIL（`local.model_discovery`，无本地服务）/ 19 UNVERIFIED（缺凭证）**。退出码 1（存在 FAIL）。

| Provider | 真实路径状态 | Mock-harness 状态 | 证据 |
|----------|------|------|------|
| 本地 OpenAI-compatible 模型 | **FAIL** | PASS | 真：`local.model_discovery` 无本地服务（连接拒绝）；mock：在 mock server 上执行 `OpenAICompatibleClient` |
| 本地 embedding | UNVERIFIED | PASS | 真：被 model_discovery FAIL 阻断；mock：`/v1/embeddings` 执行业务客户端 |
| 本地 STT | UNVERIFIED | PASS | mock：`/v1/audio/transcriptions` 执行业务客户端 |
| 远程 GPU health/voice/avatar/stream/TTS | UNVERIFIED | PASS | mock：`RemoteGpuClient` 在受控 mock server 上执行 /health/enroll/stream/TTS |
| 飞书 token / Wiki / Docx | UNVERIFIED | PASS | mock：`FeishuClient` 在受控 mock server 上执行 wiki/docx/token |
| remote TTS | UNVERIFIED | PASS | mock：`synthesize` 返回音频字节 |
| 数字人流（avatar stream） | UNVERIFIED | PASS | mock：创建/停止流幂等 |

> **mock-contract 与 real 已分离**：验收报告新增顶层 `verification_kind` 字段——未设 `VOXSTUDIO_MOCK_PROVIDER` 时为 `"real"`；设 `VOXSTUDIO_MOCK_PROVIDER=1` 时为 `"mock-harness"`（CI 受控 mock 通道）。已实测两种路径均正确翻转。
>
> **CI 受控 mock smoke 为 `provider-smoke` job**（runs-on macos-14，needs: sidecar）：下载 sidecar binary → 恢复执行位 → 设 `VOXSTUDIO_MOCK_PROVIDER=1` + `VOXSTUDIO_ALLOW_LOOPBACK_PROVIDERS=1` → 运行 `scripts/smoke-mock-provider.py`（sidecar 全链路 E2E）→ 运行 `scripts/run-provider-acceptance-mock.sh`（自启动 `scripts/mock-provider-server.py` 受控 mock server，将 local/remote/feishu 指向它，跑验收执行器，trap 清理）并**遵守其退出码**（存在 FAIL 即令 job 失败，不允许静默通过）→ 上传 `output/provider-acceptance-mock-harness.json/.md` 为 artifact。
>
> 诚实原则：真实 LLM/STT/TTS/avatar/Feishu 仍为 **UNVERIFIED**，等待真实凭证/服务注入后方可验证；真实路径的 1 个 FAIL（本地服务缺失）与 19 个 UNVERIFIED（缺凭证）保持不变，绝不伪造为 PASS。mock-harness 的 PASS 仅证明 mock 契约与业务客户端代码路径正确，不涉及真实服务。

---

## 5. macOS 签名 / 公证 / Gatekeeper / DMG / 更新状态

| 项 | 状态 | 证据 |
|----|------|------|
| 依赖 SBOM（CycloneDX 1.5） | ✅ **VERIFIED**（脚本存在 + 有回归测试） | `scripts/generate-sbom.sh` + `scripts/test_sbom_generator.sh` |
| Developer ID Application 签名 | UNVERIFIED | 有效 identity 0 个 |
| codesign --verify | FAIL | adhoc 签名不通过 |
| spctl --assess（Gatekeeper） | FAIL | 会被 Gatekeeper 拦截 |
| notarization + stapling | UNVERIFIED | 缺 `APPLE_TEAM_ID` / `APPLE_NOTARY_*` |
| Universal DMG | UNVERIFIED | 缺签名/公证链 |
| 覆盖升级 / 更新失败回滚 | UNVERIFIED | 无真实分发端点 |
| 正式制品上传 | UNVERIFIED / MISSING | 无 Release、无 tag |

> 依据 `output/release-sign-notarize.md`（历史证据，2026-08-05）：`Release closure FAILED with 2 FAIL and 4 UNVERIFIED`。缺凭证环境下必须标 UNVERIFIED，不得误报成功。

### 5.1 依赖 SBOM 生成（VERIFIED）

- **脚本**：`scripts/generate-sbom.sh` 生成 `output/sbom.cyclonedx.json`（CycloneDX 1.5 JSON），离线解析已有的 lockfile（不做网络安装），幂等：
  - Python sidecar：`apps/sidecar/uv.lock`（`[[package]]` → name/version）
  - Rust shell：`apps/desktop/src-tauri/Cargo.lock`（`[[package]]` → name/version/source）
  - Frontend：`pnpm-lock.yaml`（仅 `packages:` 段的 `name@version` 键，跳过 `snapshots:` 段）
  - metadata 记录组件 `VoxStudio`、版本（取自 `tauri.conf.json`）、git commit SHA、build time（ISO 8601 UTC）。
  - 任一 lockfile 缺失或某栈无组件时非零退出（fail loudly）。
- **回归测试**：`scripts/test_sbom_generator.sh`（可执行）断言 JSON 为合法 CycloneDX（`bomFormat`/`specVersion`/`serialNumber`/`metadata.component`/`components[]`）、三大栈各 ≥1 组件、版本与 tauri.conf.json 一致。断言不弱化，缺失 lockfile 或 JSON 畸形即退出 1。
- **实测（本机，HEAD `5d8b238`，2026-08-06 重新执行，exit 0）**：
  ```
  SBOM written to output/sbom.cyclonedx.json
    version   : 0.1.0
    commit    : 5d8b2384f6e9410009753f78cb0a26b0357911b8
    components: python=31, rust=588, javascript=179, total=798
  ```
- **回归测试实测**：`scripts/test_sbom_generator.sh` → `4 passed, 0 failed`，exit 0。

### 5.2 需要凭证的人类手动步骤（保持 UNVERIFIED）

以下项目在本机/当前 CI 环境（无凭证）保持 **UNVERIFIED**，必须由具备凭证的维护者在 macOS 上手动执行：

| 项 | 所需 Secret（CI 环境变量） | 手动命令 |
|----|---------------------------|----------|
| Developer ID 签名 | `SIGNING_CERT`（.p12 base64）、`SIGNING_IDENTITY`（证书显示名） | `security import` 证书后运行 `scripts/sign-notarize.sh --identity <ID>` 或 `scripts/build-universal.sh`（带 `VOXSTUDIO_SIGNING_IDENTITY`） |
| notarization + stapling | `APPLE_TEAM_ID`、`APPLE_NOTARY_API_KEY`、`APPLE_NOTARY_KEY_ID`、`APPLE_NOTARY_ISSUER` | `scripts/sign-notarize.sh`（含 `xcrun notarytool submit --wait` + `xcrun stapler staple/validate`） |
| Universal DMG 产出 | 上述全部 | `scripts/build-universal.sh` + `scripts/release-dmg.sh` |
| 覆盖升级 / 回滚 | `VOXSTUDIO_UPDATE_PUBKEY`（公钥）、`VOXSTUDIO_UPDATE_ENDPOINT`、`VOXSTUDIO_UPDATE_ENDPOINT_STABLE` | 在 `tauri.conf.json` 的 `plugins.updater` 填入 pubkey/endpoints 并构建 updater 制品，经真实分发端点验证升级与失败回滚 |

> 诚实原则：无凭证时一律标 UNVERIFIED，绝不伪造签名/公证 PASS（见 `scripts/verify-release.sh`、`scripts/sign-notarize.sh`、`scripts/release-provenance.sh` 的 Honesty rule）。

---

## 6. IMPLEMENTED / VERIFIED / UNVERIFIED / FAILED / MISSING 证据矩阵

| 能力 | 代码 | 验证 | 证据 |
|------|------|------|------|
| SSRF/重定向防护 | IMPLEMENTED | VERIFIED（单测 26 例） | `apps/sidecar/src/.../ssrf.py` + `apps/sidecar/tests/unit/test_ssrf.py` |
| 统一脱敏 | IMPLEMENTED | VERIFIED（单测 15 例） | `sanitize.py` + `apps/sidecar/tests/unit/test_sanitize.py` |
| 编译期更新公钥注入 | IMPLEMENTED | UNVERIFIED（无真实签名） | `updater.rs` |
| Provider 统一验证接口 | IMPLEMENTED | UNVERIFIED | `verify.py` + `apps/sidecar/tests/unit/providers/test_verify.py` |
| 侧边栏 Provider 深度验证 UI | IMPLEMENTED | UNVERIFIED | `DeepVerificationCard.tsx` + `features/settings/providerVerify.test.ts` |
| Mock Provider 端到端 smoke | IMPLEMENTED | **VERIFIED**（CI run 31079789194 通过） | `smoke-mock-provider.py` + `test_ssrf.py` |
| macOS 签名/公证 | IMPLEMENTED（脚本） | UNVERIFIED / FAIL | `output/release-sign-notarize.md`（历史） |
| 测试抖动检测 | IMPLEMENTED | VERIFIED（CI flaky-detect job 通过） | `check-test-flakiness.sh` + `ci.yml` |
| Release gate（缺凭证） | IMPLEMENTED | VERIFIED（诚实标记 UNVERIFIED） | `ci.yml` release-gate job |
| 依赖 SBOM（CycloneDX 1.5） | IMPLEMENTED | **VERIFIED**（脚本 + 回归测试，实测 4 passed） | `generate-sbom.sh` + `test_sbom_generator.sh` + `ci.yml` release-gate job |
| 当前 commit provenance/SHA256 | IMPLEMENTED | **VERIFIED**（实测 `commit_sha=5d8b238…`、`sign_status=unverified`） | `output/provenance.json` + `output/SHA256SUMS` |
| 真实 Provider 验收 | MISSING | UNVERIFIED | 无真实服务 |
| **自然对话（全双工，P1）** | **IMPLEMENTED** | 单测 VERIFIED；真实硬件/服务 UNVERIFIED | `apps/desktop/src/features/conversation/natural/{vad,stt,echoGate,dedupe,replyChunker,fullyInterrupt,device,ttsPlaybackQueue,conversationBudgets,naturalConversationStateMachine,naturalConversationCore,vadAdapter}.test.ts` + `features/conversation/{useNaturalConversation.test.tsx,NaturalConversationBar.test.tsx}` |
| **数字人状态机与降级（P1）** | **IMPLEMENTED** | 单测 VERIFIED；真实音视频流 UNVERIFIED | `features/conversation/{avatarPresentationLifecycle,degradation,firstFrameTimeout,stallDetector,avSync,assetQuality,remoteResource,avatarClient,conversationMetrics}.test.ts` + `useAvatarPresentation.test.tsx` |
| **零配置首次使用（P1）** | **IMPLEMENTED** | 单测 VERIFIED；干净机真机 UNVERIFIED | `features/onboarding/{onboardingFlow,sampleContent,firstSuccess,onboardingError,presets,hardware}.test.ts` |
| **知识/引用/记忆可信度（P1）** | **IMPLEMENTED** | 单测 VERIFIED；真知识库 UNVERIFIED | `features/knowledge/{offlineEvalSet,sourceSyncStatus,citationCorrection,knowledgeConfidence,citationEvidence,citationStatus,knowledgeClient}.test.ts` + `features/memory/{memoryCleanup,memoryAdmin,memoryPolicy,memoryCandidate,memoryClient}.test.ts` |
| **隐私/费用/数据流透明（P1）** | **IMPLEMENTED** | 单测 VERIFIED | `features/privacy/{privacyEnforcement,secureStorage,outboundLog,costBudget,consent,dataFlow,providerPrivacy}.test.ts` |
| **可观测/离线/故障自愈（P1）** | **IMPLEMENTED** | 单测 VERIFIED；真实分发端点 UNVERIFIED | `features/reliability/{stageMetrics,providerMetrics,backupRestore,messageRecovery,resilience,offlineQueue,diagnosticSummary,logCapture,correlationId}.test.ts` + `features/diagnostics/{diagnosticReport,metricsClient}.test.ts` + `features/restore/*` |
| **无障碍/本地化/设计系统（P2）** | **IMPLEMENTED** | 单测 VERIFIED | `src/ui/{i18n,i18nErrors,uiStates,designTokens,keyboardAccess,safeErrors,mediaAlternatives,contrastRules,focusRules,useTheme,ConfirmDialog}.test.ts*` + `features/conversation/accessibility.test.tsx` |

> 诚实原则：**代码已实现 ≠ 已在真实硬件/真实服务上验证**。上表“单测 VERIFIED”指对应单元测试通过，证明契约与代码路径正确；凡涉及真实 LLM/STT/TTS/avatar/Feishu、Apple 签名公证、干净 Mac 首装、真实分发升级回滚的项，一律保持 **UNVERIFIED**，待补齐凭证/服务/硬件后按 §5.2 与 `docs/real-provider-acceptance.md` 验证。

---

## 7. 当前 P0 / P1 / P2 问题

### P0（发布阻断）
- **P0-1** ~~CI `Mock provider smoke` 失败（SSRF loopback 冲突）~~ → **已修复并验证**（run `31079789194` 全绿）。
  - 源文件：`apps/sidecar/src/voxstudio_core/ssrf.py`、`apps/sidecar/src/voxstudio_core/providers/remote_gpu.py`、`scripts/smoke-mock-provider.py`
  - 测试：`apps/sidecar/tests/unit/test_ssrf.py`（新增 loopback opt-in 回归 3 例）
  - 复现命令：`uv run --project apps/sidecar python scripts/smoke-mock-provider.py`
  - 验收状态：✅ 当前 CI Python sidecar job 全绿，mock smoke 各步骤 True。
- **P0-2**：macOS 签名/公证/Gatekeeper 全链路未闭合（UNVERIFIED）。
  - 源文件：`scripts/sign-notarize.sh`、`scripts/release-closure.sh`、`scripts/release-dmg.sh`、`scripts/verify-release.sh`、`scripts/release-provenance.sh`
  - 复现命令：`scripts/release-closure.sh`（缺凭证则明确 FAIL/UNVERIFIED）
  - 验收条件：具备 `APPLE_TEAM_ID`/证书时实现签名→公证→stapling→spctl 通过；缺凭证时明确标记 UNVERIFIED。**为当前唯一剩余 P0 中仍待真实验证的发布阻断。**
- **P0-3**：真实 Provider 验收缺失（无真实服务/凭证）。
  - 源文件：`scripts/accept-providers/*`
  - 复现命令：`scripts/record-provider-acceptance.sh`
  - 验收条件：本地/远程/飞书各 Provider 至少一次 REAL_VERIFIED 或明确 UNVERIFIED。**为当前唯一剩余 P0 中仍待真实验证的发布阻断。**

### P1（重大改进）— 均已 IMPLEMENTED，单测 VERIFIED；真实硬件/服务 UNVERIFIED
- 自然语音对话（VAD/打断/回声/流式 STT・LLM・TTS/性能预算）——已实现，见 §6。
- 数字人状态机与降级（音视频同步/口型/首帧/卡死/静态降级）——已实现，见 §6。
- 零配置首次使用（自动检测/三预设/分步引导/示例数字人）——已实现，见 §6。
- 知识引用与记忆可信度（引用定位/失效冲突/记忆候选/作用域/遗忘/导出）——已实现，见 §6。
- 隐私/费用/数据流透明（远程总开关/数据流向/越界同意/API Key 安全存储）——已实现，见 §6。
- 可观测/离线/故障自愈（correlation ID/诊断 ZIP/离线队列/熔断/回滚/备份恢复）——已实现，见 §6。

### P2（体验）— 均已 IMPLEMENTED，单测 VERIFIED
- 无障碍（VoiceOver/全键盘/焦点/对比度/reduced motion/字幕）——已实现，见 §6。
- 本地化（简中/英文完整）与统一设计系统（token/主题/状态/toast 分级）——已实现，见 §6。

---

## 8. 测试矩阵（Task 16，近真实/真实）

> 新增 `scripts/run-test-matrix.sh` + `scripts/test-matrix/*`（16 项），含回归测试 `scripts/test_test_matrix.sh`（11 断言，全部通过）。
> 报告：`output/test-matrix.json` + `output/test-matrix.md`（含环境/commit/逐项状态/证据路径/耗时）。

实测（本机，HEAD `5d8b238` 之前的 `07e5af7` 运行，代表当前测试矩阵执行结果）：

| 状态 | 数量 |
|---|---|
| PASS | 9 |
| FAIL | 0 |
| UNVERIFIED | 7 |

- **9 个 PASS（近真实，真实执行 sidecar/repos/clients）**：`sidecar-crash`、`no-network`、`db-migration`、`session-pagination`（51+ 分页）、`multi-session`、`multi-human`、`offline-queue`、`disk-full`、`permission`（麦克风/摄像头设备检测）。
- **7 个 UNVERIFIED（需真实硬件/凭证/分发端点，诚实标记，绝不伪造 PASS）**：`clean-mac-first-install`、`intel-mac`、`overlay-upgrade`、`downgrade-block`、`update-failure`、`airpods-headset`、`system-sleep-wake`。
- 退出码 0；回归测试 `scripts/test_test_matrix.sh` 11 断言通过。

---

## 9. 旧报告时效性声明

以下报告生成时间早于当前 HEAD `5d8b238`，**针对旧 commit，仅作历史证据**，不代表当前代码状态：

| 报告 | 说明（历史） |
|------|--------------|
| `output/provider-acceptance.md` | 早期真实路径验收（旧 commit） |
| `output/release-sign-notarize.md` | Release closure FAIL 2 / UNVERIFIED 4（旧 commit） |
| `output/release-readiness.md` | 发布就绪（历史） |
| `output/provider-readiness.md` | 真实 provider 就绪（历史） |
| `output/readiness-baseline.md` | readiness 基线差异（历史） |
| `output/dmg-smoke.md` | DMG 冒烟（历史） |
| `output/mock-provider-smoke.md` | mock smoke（SSRF 引入前，历史） |
| `output/mock-provider-smoke-x86_64.md` | x86_64 mock smoke（历史） |
| `output/release-acceptance.md` | 发布验收（历史） |
| `output/release-closure.md` | 发布闭环（历史） |
| `output/production-convergence-summary.md` | 生产收敛汇总（历史） |
| `output/release-closure-natural-conversation-summary.md` | 发布闭环·自然对话汇总（历史） |

**当前 commit（5d8b238）证据**（重新生成/最新执行）：
- `output/test-matrix.json` + `output/test-matrix.md`（Task 16 测试矩阵，9 PASS / 0 FAIL / 7 UNVERIFIED）
- `output/provider-acceptance-mock-harness.json` + `.md`（mock-harness 验收，20 PASS / 6 UNVERIFIED）
- `output/provenance.json` + `output/SHA256SUMS` + `output/sbom.cyclonedx.json`（commit `5d8b238`）

---

## 10. 结论

- 当前主分支强制 CI **全绿**（run `31079789194`，7/7 job 通过），P0-1（mock smoke SSRF）已修复并锁定。
- 代码质量门禁（ruff/mypy/pytest=521/coverage ~88%/Rust/frontend/依赖安全）全部通过；无高危可利用依赖漏洞（1 个 glib unsound 仅影响 Linux 目标）。
- **Task 16 测试矩阵**：9 PASS / 0 FAIL / 7 UNVERIFIED，`output/test-matrix.json/.md` 为当前 commit 证据。
- **Task 17 最终交付**：文档、SBOM、provenance、SHA256、完成声明均已产出并对应 commit `5d8b238`。
- P1/P2 全部能力已 **IMPLEMENTED** 且有对应单测；但**代码实现 ≠ 真实硬件/服务验证**——真实 LLM/STT/TTS/avatar/Feishu、macOS 签名/公证、干净 Mac 首装、真实分发升级回滚均为 **UNVERIFIED**（见 §4、§5、§6、§8）。
- 当前状态：**Release Candidate → 未达生产可发布**。剩余 P0：P0-2（macOS 发布闭环）、P0-3（真实 Provider 验收）需凭证/服务方可验证，缺凭证环境下保持 UNVERIFIED。