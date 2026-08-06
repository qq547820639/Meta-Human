# 最新生产基线审计（Latest Production Audit）

> 生成时间：2026-08-06（Asia/Shanghai）
> 审计对象：`qq547820639/Meta-Human` 的 `main` 分支
> 审计原则：以最新代码、最新 CI、重新执行的命令为准，不采信 README/checklist/历史报告的“已完成”声明。

---

## 1. 基线标识

| 项 | 值 |
|----|----|
| 当前 commit SHA | `31a7be2`（`docs(release): add production readiness report + mark security closure`） |
| 与 origin/main | 一致（`git status` up to date） |
| 当前版本号 | `0.1.0`（package.json / Cargo.toml / pyproject.toml / tauri.conf.json 一致） |
| 版本标签 | 无 tag |
| GitHub Release | 无正式 Release |
| CPU 架构 | aarch64（Apple Silicon） |

---

## 2. 最新 GitHub Actions 状态

对当前 HEAD `31a7be2` 的正式 `push` 触发的 CI run (`31068034214`) 结果：

| Job | 结果 | 说明 |
|-----|------|------|
| Dependency vulnerabilities | ✅ success | 依赖漏洞扫描通过 |
| Python sidecar | ❌ **failure** | **Mock provider smoke 步骤失败** |
| Frontend (TS / vitest) | ⏭️ skipped | 上游 Python job 失败导致跳过 |
| Rust shell | ⏭️ skipped | 上游失败导致跳过 |
| Release gate | ⏭️ skipped | 上游失败导致跳过 |

> 注：`gh run list` 中显示为 `success` 的 `Dependabot Updates` run 是 dependabot 自动更新专用的合成 workflow，**不执行完整 CI**，不代表真实 CI 全绿。

### 失败根因（已复现确认）

`Mock provider smoke`（`scripts/smoke-mock-provider.py`）失败：

```
pydantic_core._pydantic_core.ValidationError: 1 validation error for RemoteGpuConfig
base_url
  Value error, base_url must not target a loopback host
  [input_value='http://127.0.0.1:49212', input_type=str]
```

- 根因：`apps/sidecar/src/voxstudio_core/ssrf.py` 的 `validate_remote_base_url` 默认拒绝 loopback 目标（正确的安全默认），但 `scripts/smoke-mock-provider.py` 把 `VOXSTUDIO_REMOTE_BASE_URL` / `VOXSTUDIO_FEISHU_BASE_URL` 指向本机 `127.0.0.1` mock 服务，导致 sidecar 启动时构造 `RemoteGpuConfig` 抛 `ValidationError`，进程崩溃、`healthz` 永不为 200，smoke 返回 1。
- 本地复现：`RemoteGpuConfig(base_url="http://127.0.0.1:12345")` → REJECTED。
- 修复（本次已实施）：新增 `VOXSTUDIO_ALLOW_LOOPBACK_PROVIDERS` 显式开关（生产默认拒绝），mock 测试 harness 显式置 `1`；`ssrf.py` 在开关开启时允许 loopback 作为远程/飞书 Provider 目标，但 link-local/cloud-metadata/multicast 仍拒绝。已补 3 条回归测试。

---

## 3. 质量门禁状态矩阵（重新执行结果）

本地在 `31a7be2` 复跑（`apps/sidecar`）：

| 门禁 | 命令 | 结果 |
|------|------|------|
| Python ruff | `uv run --project apps/sidecar ruff check apps/sidecar/src apps/sidecar/tests` | ✅ 通过（本次修改后） |
| Python mypy | `uv run --project apps/sidecar mypy apps/sidecar/src` | ✅ 通过（58 源文件） |
| Python pytest | `uv run --project apps/sidecar pytest apps/sidecar/tests` | ✅ 通过（521 passed） |
| Python 覆盖率 | CI `--cov-fail-under=80` | 前次 CI 记录 ~88%，本次待复跑确认 |
| Rust fmt / clippy / test / audit | `apps/desktop/src-tauri` | 本次 Push run 被跳过，需复跑 |
| 前端 tsc / eslint / vitest | `apps/desktop` | 本次 Push run 被跳过，需复跑 |
| 前端依赖漏洞 | `pnpm audit` | `Dependency vulnerabilities` job 通过（含前端+npm） |
| Release gate | `scripts/*` | 本次被跳过，需复跑 |

**结论：当前 commit 的强制 CI 为红色（Python sidecar 的 mock smoke 失败）。** 修复已提交到工作区，待重建 sidecar 二进制后复跑 smoke 并推送。

---

## 4. 真实 Provider 可用性（UNVERIFIED）

| Provider | 状态 | 证据 |
|----------|------|------|
| 本地 OpenAI-compatible 模型 | UNVERIFIED | 缺真实服务/模型 |
| 本地 embedding | UNVERIFIED | 缺真实服务 |
| 本地 STT | UNVERIFIED | 缺真实服务 |
| 远程 GPU | UNVERIFIED | 缺服务/凭证 |
| 飞书 token / Wiki / Docx | UNVERIFIED | 缺凭证 |
| remote TTS | UNVERIFIED | 缺服务 |
| 数字人流（avatar stream） | UNVERIFIED | 缺服务 |

> 所有真实 Provider 均无可信环境验证；`output/provider-acceptance.md`、`output/provider-readiness.md` 等旧报告为 **历史证据**（生成于 2026-08-05，早于当前 HEAD），需在当前 commit 上重新生成。

---

## 5. macOS 签名 / 公证 / Gatekeeper / DMG / 更新状态

| 项 | 状态 | 证据 |
|----|------|------|
| Developer ID Application 签名 | UNVERIFIED | 有效 identity 0 个 |
| codesign --verify | FAIL | adhoc 签名不通过 |
| spctl --assess（Gatekeeper） | FAIL | 会被 Gatekeeper 拦截 |
| notarization + stapling | UNVERIFIED | 缺 `APPLE_TEAM_ID` / `APPLE_NOTARY_*` |
| Universal DMG | UNVERIFIED | 缺签名/公证链 |
| 覆盖升级 / 更新失败回滚 | UNVERIFIED | 无真实分发端点 |
| 正式制品上传 | UNVERIFIED / MISSING | 无 Release、无 tag |

> 依据 `output/release-sign-notarize.md`（历史证据，2026-08-05）：`Release closure FAILED with 2 FAIL and 4 UNVERIFIED`。缺凭证环境下必须标 UNVERIFIED，不得误报成功。

---

## 6. IMPLEMENTED / VERIFIED / UNVERIFIED / FAILED / MISSING 证据矩阵

| 能力 | 代码 | 验证 | 证据 |
|------|------|------|------|
| SSRF/重定向防护 | IMPLEMENTED | VERIFIED（单测 26 例） | `ssrf.py` + `test_ssrf.py` |
| 统一脱敏 | IMPLEMENTED | VERIFIED（单测 15 例） | `sanitize.py` + `test_sanitize.py` |
| 编译期更新公钥注入 | IMPLEMENTED | UNVERIFIED（无真实签名） | `updater.rs` |
| Provider 统一验证接口 | IMPLEMENTED | UNVERIFIED | `verify.py` |
| 侧边栏 Provider 深度验证 UI | IMPLEMENTED | UNVERIFIED | `DeepVerificationCard.tsx` |
| Mock Provider 端到端 smoke | IMPLEMENTED | **FAILED（SSRF loopback）** | CI run 31068034214 |
| macOS 签名/公证 | IMPLEMENTED（脚本） | UNVERIFIED / FAIL | `release-sign-notarize.md` |
| 真实 Provider 验收 | MISSING | UNVERIFIED | 无真实服务 |
| 自然对话（VAD/打断/回声） | 部分 | UNVERIFIED | 待深入 |
| 数字人状态机与降级 | 部分 | UNVERIFIED | 待深入 |
| 零配置首次使用 | 部分 | UNVERIFIED | 待深入 |
| 知识/引用/记忆可信度 | 部分 | UNVERIFIED | 待深入 |
| 隐私/费用/数据流透明 | 部分 | UNVERIFIED | 待深入 |
| 可观测/离线/故障自愈 | 部分 | UNVERIFIED | 待深入 |
| 无障碍/本地化/设计系统 | 部分 | UNVERIFIED | 待深入 |

---

## 7. 当前 P0 / P1 / P2 问题

### P0（发布阻断）
- **P0-1**：CI `Mock provider smoke` 失败（SSRF loopback 冲突）。
  - 源文件：`apps/sidecar/src/voxstudio_core/ssrf.py`、`apps/sidecar/src/voxstudio_core/providers/remote_gpu.py`、`scripts/smoke-mock-provider.py`
  - 测试：`apps/sidecar/tests/unit/test_ssrf.py`
  - 复现命令：`uv run --project apps/sidecar python scripts/smoke-mock-provider.py`（需先建好 sidecar 二进制）
  - 验收条件：CI Python sidecar job 全绿，mock smoke 各步骤 True。
- **P0-2**：macOS 签名/公证/Gatekeeper 全链路未闭合（FAIL/UNVERIFIED）。
  - 源文件：`scripts/sign-notarize.sh`、`scripts/release-closure.sh`、`scripts/release-dmg.sh`
  - 复现命令：`scripts/release-closure.sh`（缺凭证则明确 FAIL/UNVERIFIED）
  - 验收条件：具备 `APPLE_TEAM_ID`/证书时实现签名→公证→stapling→spctl 通过；缺凭证时明确标记 UNVERIFIED。
- **P0-3**：真实 Provider 验收缺失（无真实服务/凭证）。
  - 源文件：`scripts/accept-providers/*`
  - 复现命令：`scripts/record-provider-acceptance.sh`
  - 验收条件：本地/远程/飞书各 Provider 至少一次 REAL_VERIFIED 或明确 UNVERIFIED。

### P1（重大改进）
- 自然语音对话（VAD/打断/回声/流式/性能预算）。
- 数字人状态机与降级（音视频同步/口型/首帧/卡死/静态降级）。
- 零配置首次使用（自动检测/三预设/分步引导）。
- 知识引用与记忆可信度（引用定位/失效冲突/记忆候选/作用域/遗忘/导出）。
- 隐私/费用/数据流透明（远程总开关/数据流向/越界同意/API Key 安全存储）。
- 可观测/离线/故障自愈（correlation ID/诊断 ZIP/离线队列/熔断/回滚/备份恢复）。

### P2（体验）
- 无障碍（VoiceOver/全键盘/焦点/对比度/reduced motion/字幕）。
- 本地化（简中/英文完整）与统一设计系统（token/主题/状态/toast 分级）。

---

## 8. 旧报告时效性声明

以下报告生成时间早于当前 HEAD `31a7be2`（2026-08-06T03:17Z），**针对旧 commit，仅作历史证据**，不代表当前代码状态：

| 报告 | 生成时间 | 结论（历史） |
|------|----------|--------------|
| `output/mock-provider-smoke.md` | 2026-08-05T08:11Z | 全部 True（SSRF 引入前） |
| `output/release-sign-notarize.md` | 2026-08-05T08:11Z | FAIL 2 / UNVERIFIED 4 |
| `output/provider-acceptance.md` | 历史 | UNVERIFIED |
| `output/provider-readiness.md` | 历史 | UNVERIFIED |
| `output/release-readiness.md` | 历史 | UNVERIFIED |
| `output/readiness-baseline.md` | 历史 | 基线差异清单 |

以上报告需在当前 commit 用重新执行的命令重新生成，或明确继续标为历史证据。

---

## 9. 结论

- 当前主分支强制 CI **为红色**（唯一失败：Python sidecar 的 mock smoke 因 SSRF loopback 冲突）。
- 代码质量门禁（ruff/mypy/pytest=521/SSRF 单测=26）本地通过。
- macOS 签名/公证、真实 Provider、真实发布/更新闭环均 UNVERIFIED，缺凭证/服务/硬件。
- 当前状态：**Release Candidate → 未达生产可发布**，需先修复 P0-1（本次已修复待验证），再完成 P0-2/P0-3。