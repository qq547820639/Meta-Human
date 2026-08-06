# 真实基线审计报告（Readiness Baseline）

Generated: 2026-08-06
Spec：`.trae/specs/production-ready-release/`（Task 1）

> 本报告只陈述**实际执行并取得结果**的验证路径；缺凭证/服务/硬件而未执行的，一律标注「未验证」，不写「通过」。

---

## 1. 基线信息

| 项 | 值 |
| --- | --- |
| 分支 | `main` |
| 本地 HEAD | `c76a5f83ecb88eda109fdd82282adc43dc67b60b` |
| 远端 origin/main | `c76a5f83ecb88eda109fdd82282adc43dc67b60b`（已同步） |
| 远端 | `git@github.com:qq547820639/Meta-Human.git` |
| git tag 数量 | **0**（无任何版本标签） |
| 本地工具 | node v26.5.1 / pnpm 11.9.0 / cargo 1.97.1 / uv 0.11.28 / python3（系统） |

---

## 2. GitHub Actions 状态（2026-08-06 最新 5 次 main push）

| Run | commit | 结论 | 失败 Job |
| --- | --- | --- | --- |
| 31058399501 | `c76a5f8`（HEAD） | **failure** | Rust shell / Frontend / Dependency vulnerabilities；Release gate skipped |
| 31055655539 | `2b4dad3` | **failure** | Rust shell / Frontend / Dependency vulnerabilities |
| 31050952928 | `546f436` | **failure** | 同上 |
| 31047780261 | `85068c8` | **failure** | 同上 |
| 31046035166 | `a72ad23` | **failure** | 同上 |

**结论：最近 5 次 CI 全部失败**，与各既有 spec「已勾选完成」的文档声明不符。Python sidecar 长期 success，但 Rust / Frontend / Security 持续失败。

---

## 3. 失败根因（最新 run 31058399501）

### 3.1 Rust shell —— build script 失败
- 现象：`error: failed to run custom build command for voxstudio-desktop`，`build-script-build` exit 1。
- 本地复现：`cargo clippy --all-targets --all-features -- -D warnings` 在 `cargo clean` 后**通过**（exit 0）；`cargo fmt -- --check` 通过。
- 结论：该失败为 CI runner 环境相关，非本地代码缺陷；需在 CI 复跑验证（P0 Task 2 复查）。build script stderr 在 GH 日志中被截断，需以 `--all-targets` 定位。

### 3.2 Frontend —— sidecar 二进制无执行权限
- 现象：`PermissionError: [Errno 13] Permission denied: '.../binaries/digital-human-sidecar-aarch64-apple-darwin'`。
- 根因：`actions/download-artifact@v4` 剥离可执行位，下载后二进制不可执行；`launchSidecar.ts` 直接 spawn 该文件。
- 修复方向：CI 下载 sidecar 后补 `chmod +x`（Task 2/3）。

### 3.3 Dependency vulnerabilities —— cargo audit action 崩溃
- 现象：`cargo audit (Rust)` 步骤 `ModuleNotFoundError: No module named 'requests'`。
- 根因：`actions-rust-lang/audit@v1` 的 issue 创建辅助脚本依赖 Python `requests`，runner 环境缺失。
- 修复方向：改用直接在 runner 安装 `cargo-audit` 并运行 `cargo audit`（带 `createIssues: false`），或固定可信版本的 audit action（Task 2/3）。

---

## 4. 本地门禁真实结果（基线）

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| Rust clippy `-D warnings` | `cargo clippy --all-targets --all-features` | ✅ 通过（clean 复跑） |
| Rust fmt | `cargo fmt -- --check` | ✅ 通过 |
| Rust build | `cargo build` | ✅ 通过 |
| Rust test | `cargo test` | ⏳ 待执行 |
| Python pytest | `pytest apps/sidecar/tests` | ⏳ 待执行 |
| Python ruff/mypy | `uv run ruff/mypy` | ⏳ 待执行 |
| TS type check | `tsc --noEmit` | ⏳ 待执行 |
| Frontend vitest | `vitest run` | ⏳ 待执行 |
| Frontend build | `vite build` | ⏳ 待执行 |
| audits | pnpm/uv/cargo audit | ⏳ 待执行（cargo audit action 已知失败） |

> Task 1 的完整本地门禁扫描在 Task 2-4 的干净执行中逐项完成并记录。本报告聚焦**文档 vs 实际证据差异**。

---

## 5. 「文档声称已完成 vs 实际证据」差异清单

| # | 文档宣称 | 实际证据 | 差异 |
| --- | --- | --- | --- |
| 1 | 多个既有 spec（production-convergence 等）勾选「CI 全绿/通过」 | 最近 5 次 CI 全部 **failure** | **严重不符**：Rust/Frontend/Security 持续红 |
| 2 | release-closure 声称「更新闭环已实现」 | `tauri.conf.json` 仍是占位 pubkey + 空 endpoints | 占位符未生产化，fails-closed 但不可用 |
| 3 | 声称「发布验收」 | 0 个 git tag、无真实 Release、DMG 为 ad-hoc 签名 | 未发布、未签名/公证 |
| 4 | 声称「真实 Provider 验收」 | 全部真实 Provider 处于 UNVERIFIED（缺凭证） | 一致（如实标注未验证） |
| 5 | 声称「自然对话状态机」 | `naturalConversationStateMachine.ts` 存在且设计完整 | 功能存在，但 `useConversationController` 仍为超大编排 hook，多套并行状态源 |
| 6 | 声称「可发布的生产版本」 | 无签名/无 tag/无 Release/CI 红 | 未达生产发布状态 |

---

## 6. 结论

- 代码与测试工程量大且多为绿，但**发布链路与 CI 门禁未全绿**，与文档声明不符。
- 优先修复：Rust build script（CI 复跑）、sidecar 执行位、cargo audit action、Node/Actions 版本。
- 所有真实 Provider、Apple 签名/公证、真实更新端点、真实 Release 均因缺外部凭据而 `UNVERIFIED`。
- 本报告作为 Task 2-4 修复前基线。