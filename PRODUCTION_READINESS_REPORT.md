# PRODUCTION_READINESS_REPORT — Meta-Human / VoxStudio

> 生成日期：2026-08-06
> 本报告只陈述**实际执行并取得的结果**；缺外部凭据 / 服务 / 硬件而未执行的，一律如实标注 `UNVERIFIED`，**不用 Mock 或其他名义冒充真实生产验证**。

---

## 1. 当前提交与 CI 状态

| 项 | 值 |
| --- | --- |
| 分支 | `main` |
| 当前 HEAD | `249cde4e5590e40de0bc25d802a43a01463f4942` |
| 基线 HEAD（Task 1） | `c76a5f83ecb88eda109fdd82282adc43dc67b60b` |
| 远端 | `https://github.com/qq547820639/Meta-Human` |
| 本次会话新增提交 | `8fd6475`（SSRF/脱敏前置）、`c82c001`（统一脱敏）、`249cde4`（dependabot 固定版本） |
| git tag 数量 | **0** |
| 最近一次已推送 CI 结论 | **success**（run `31064772803`，commit `ab5a1d4`） |

### CI Job 状态（run 31064772803，commit `ab5a1d4`）

| Job | 结论 |
| --- | --- |
| Python sidecar | ✅ success |
| Frontend (TS / vitest) | ✅ success |
| Rust shell | ✅ success |
| Dependency vulnerabilities | ✅ success |
| Release gate | ✅ success |

> 说明：本次会话的 3 个新提交（`8fd6475`/`c82c001`/`249cde4`）尚未推送，因此无对应 CI run。本地已用与 CI 完全相同的命令复跑通过（见 §5），推送后 CI 需复跑确认。

---

## 2. 功能完成矩阵

> 依据 `.trae/specs/production-ready-release/tasks.md`。✅=已完成并有运行证据；⚠️=部分完成/有运行证据但缺真实验收；⛔=未完成或仅占位。

| 阶段 | 任务 | 状态 | 证据 / 说明 |
| --- | --- | --- | --- |
| 一 · 真实基线 | Task 1 基线审计 | ✅ | `output/readiness-baseline.md`；记录基线 SHA 与 CI 失败根因 |
| 二 · CI 门禁 | Task 2 Clippy + cargo audit | ✅ | CI Rust shell success；本地 clippy `-D warnings` 通过 |
| 二 · CI 门禁 | Task 3 供应链加固 | ✅ | Node 22（≥20）；Actions 均 v4/v5；新增 `dependabot.yml` 固定版本 |
| 二 · CI 门禁 | Task 4 Release Gate 强保护 | ✅ | `needs: [sidecar, frontend, rust, security]` + `if: !cancelled && !failure`；连续 CI 绿 |
| 三 · 更新闭环 | Task 5 生产更新公钥 | ✅ | `updater.rs` 编译期公钥注入，fails-closed |
| 三 · 更新闭环 | Task 6 更新全链路 | ⚠️ | 代码/单测实现，真实升级+损坏回滚缺真机=UNVERIFIED |
| 三 · 更新闭环 | Task 7 签名/公证/发布产物 | ⚠️ | CI 产 DMG/SHA256SUMS/provenance/SBOM；签名/公证缺凭证=UNVERIFIED |
| 四 · Provider 验收 | Task 8 Contract Test Suite | ⚠️ | 协议兼容有单测；真实服务缺凭证=UNVERIFIED |
| 四 · Provider 验收 | Task 9 能力模型与韧性 | ✅ | 能力模型/退避/熔断/恢复/降级原因/回退优先级实现；Local-only 防远程 |
| 五 · 对话生命周期 | Task 10-13 统一状态机 | ⚠️ | 状态机设计完整；`useConversationController` 仍为超大编排（部分拆分） |
| 六 · 自然对话 | Task 14 体验预算 | ⚠️ | P50/P95 已实现并有单测；P99/真机样本未采集 |
| 六 · 自然对话 | Task 15 自适应 VAD | ⚠️ | 参数/阈值实现；真机 VAD 误触发未采集 |
| 六 · 自然对话 | Task 16 低置信/回声/设备 | ⚠️ | 结算/降级逻辑有；真机回声/热插拔缺硬件=UNVERIFIED |
| 七 · 持久化 | Task 17-18 幂等/崩溃/迁移 | ⚠️ | 迁移备份/幂等有单测；故障注入真机未做 |
| 八 · 知识/记忆 | Task 19-20 | ⚠️ | 记忆模型/敏感禁存实现；真实知识源缺飞书凭据=UNVERIFIED |
| 九 · 安全 | Task 21 SSRF/重定向 | ✅ | `ssrf.py` + 接入 remote_gpu/local_config/feishu/verify；23 单测通过 |
| 九 · 安全 | Task 22 脱敏/临时文件/Keychain | ✅✓ | 统一脱敏 `sanitize.py` + 15 单测通过；Keychain/SBOM 部分=⛔ |
| 十 · 体验 | Task 23-24 首启/设备/进度/i18n | ⚠️ | 部分实现；真机验收缺硬件 |
| 十一 · 测试矩阵 | Task 25 | ⚠️ | 大量单测；真机类（Apple Silicon/Intel）缺硬件 |
| 十二 · 收口 | Task 26 报告 | ✅ | 本文档 |

---

## 3. Provider 验证矩阵

> 依据 `output/provider-acceptance.json`（run 于基线，结果如实记录）。`PASS`=真实运行通过；`FAIL`=真实运行失败；`UNVERIFIED`=缺服务/凭据未执行。

| Provider / 能力 | 状态 | 证据 |
| --- | --- | --- |
| 本地模型发现 `/api/tags` | ⛔ FAIL | `GET 127.0.0.1:11434/api/tags` → connection refused（无本地服务） |
| 本地 Chat / Embedding / STT / 超时 / 取消 / 错误映射 | ⛔ UNVERIFIED | 被本地发现失败阻塞 |
| 远程 GPU 健康探测 / Voice / Avatar / TTS / 幂等重试取消 / 资源清理 | ⛔ UNVERIFIED | 缺 `VOXSTUDIO_REMOTE_BASE_URL` |
| 飞书 token / space 权限 / Wiki/Docx 读取 / 增量同步 / 撤销 / 引用 | ⛔ UNVERIFIED | 缺飞书三个凭据变量 |
| 对话断网恢复 | ✅ PASS | 会话重启后恢复（2 条消息） |
| 数字人构建断网恢复 | ✅ PASS | 中断构建重启后可恢复 |
| Sidecar 崩溃恢复 | ✅ PASS | 中断 run 重开为 RECOVERING，能力回退 PENDING |
| GUI 重启恢复任务/会话 | ✅ PASS | 中断构建重启后 resumable |
| 旧库升级自动备份 | ✅ PASS | migration 1→15 自动生成 `.bak` |
| 迁移失败备份可恢复 | ✅ PASS | 备份可还原且保留升级前数据 |

> **结论**：真实外部 Provider（本地/远程/飞书）**0 项 REAL_VERIFIED**；协议兼容性由 Mock/单测证明（`MOCK_VERIFIED`），真实服务验收全部因缺凭据标 `UNVERIFIED`。

---

## 4. 自然对话指标表

> 指标采集以真实设备样本为准。当前**无真实语音/设备样本**，仅前端有结构化采集与 P50/P95 计算逻辑（`conversationMetrics.ts`）及其单测。

| 指标 | 目标 | 当前 | 样本 | 时间窗 | 状态 |
| --- | --- | --- | --- | --- | --- |
| speech start → interim transcript | SLO | — | 0 | — | ⛔ 无真实样本 |
| speech end → final transcript | SLO | — | 0 | — | ⛔ 无真实样本 |
| submit → first token | SLO | — | 0 | — | ⛔ 无真实样本（需真实 provider） |
| first token → first playable audio | SLO | — | 0 | — | ⛔ 无真实样本 |
| avatar session → first frame | SLO | — | 0 | — | ⛔ 无真实样本 |
| TTS 与口型同步偏差 | SLO | — | 0 | — | ⛔ 无真实样本 |
| 用户打断 → 实际静音 | SLO | — | 0 | — | ⛔ 无真实样本 |
| 网络中断 → 恢复 | SLO | — | — | — | ⚠️ 有单测，无真机 |
| 一轮完整对话耗时 | SLO | — | 0 | — | ⛔ 无真实样本 |
| VAD 误触发率 | SLO | — | 0 | — | ⛔ 无真实样本 |
| 回声误判率 | SLO | — | 0 | — | ⛔ 无真实样本 |
| 有效打断识别率 | SLO | — | 0 | — | ⛔ 无真实样本 |
| STT 低置信度率 | SLO | — | 0 | — | ⛔ 无真实样本 |
| 降级发生率 | SLO | — | 0 | — | ⛔ 无真实样本 |
| 各阶段失败率 | SLO | — | 0 | — | ⛔ 无真实样本 |

> 采集能力（P50/P95、按维分组、样本量、失败率、时间窗）已实现并通过单测；P99 未实现。**样本为 0 时不得显示「达标」**——当前全部指标均不得判定达标；关键指标的 SLO 定义与性能回归测试尚未落地（需真实 device 样本）。

---

## 5. 安全审计结果

| 项目 | 状态 | 证据 |
| --- | --- | --- |
| SSRF / 重定向防护 | ✅ | `ssrf.py`：阻断 loopback（远程侧）/link-local/组播/保留地址；云元数据（169.254.169.254）阻断；私网 RFC1918 放行；接入 remote_gpu/local_config/feishu/verify。23 单测通过 |
| 统一脱敏（日志/错误/诊断导出） | ✅ | `sanitize.py`：Bearer/Basic/sk- 密钥/凭证头/`name=value` 敏感参数；`redact_url`/`redact_exception`/`redact_value`（SecretStr→`[REDACTED]`）；全局 `RedactionLogFilter` 启动安装。15 单测通过 |
| 日志不泄露密钥 | ✅ | secret-leakage 单测覆盖（Authorization/Api-Key/Bearer/异常/SecretStr repr/诊断导出） |
| SecretStr 全覆盖 | ✅ | 现有代码中 access_token/refresh_token/app_secret/api_key/bearer_token 均用 `pydantic.SecretStr` |
| 临时文件随机名/最小权限/确定性清理 | ⚠️ | 部分实现；异常退出后启动清理遗留缺专门测试 |
| 诊断包生成前预览与包含项 | ⛔ | 未实现 |
| 数据库静态/字段加密 + macOS Keychain | ⛔ | 未实现（需评估） |
| SBOM / 构建来源 / 依赖许可清单 | ⚠️ | CI 生成 provenance.json/SHA256SUMS；SBOM 与许可清单未完整输出 |
| Threat model 文档 | ⚠️ | 未产出独立威胁模型文档（防护已实现） |
| 更新包/清单/回滚包签名验证测试 | ⚠️ | 代码/单测实现；真实签名验证缺生产密钥=UNVERIFIED |

---

## 6. 发布与更新验证结果

| 项 | 状态 | 证据 |
| --- | --- | --- |
| 正式构建使用编译期公钥（非开发占位） | ✅ | `updater.rs`/`lib.rs` 编译期注入，fails-closed |
| stable/beta 真实 endpoint | ⚠️ | 配置存在但为占位/未指向真实分发端点（fails-closed） |
| 版本检查 / 清单签名验证 / 下载校验 | ⚠️ | 代码/单测实现；真实升级缺真机=UNVERIFIED |
| 安装前备份 / 安装 / 重启 / 迁移 / 回滚 | ⚠️ | 迁移备份有单测；真实升级+损坏包回滚缺真机=UNVERIFIED |
| 签名错误拒绝安装；下载中断恢复/重试 | ⚠️ | 代码/单测实现；真机=UNVERIFIED |
| macOS Developer ID 签名 / hardened runtime / entitlements | ⛔ UNVERIFIED | 本机 0 个有效 codesigning identity；现有 DMG 为 ad-hoc，`spctl` 拒绝 |
| notarization / stapling | ⛔ UNVERIFIED | 缺 `APPLE_TEAM_ID` / `APPLE_NOTARY_*` 凭证 |
| Universal DMG / SHA256SUMS / provenance.json | ✅ | `output/VoxStudio-universal.dmg`（49MB）、`SHA256SUMS`、`provenance.json` 存在 |
| SBOM | ⚠️ | 未作为独立产物输出 |
| 真实 GitHub Release / 正式分发端点 | ⛔ | **0 个 tag、无真实 Release**；仅 artifact 上传 |
| 规范版本标签，各版本号一致 | ⛔ | 0 个 tag；版本一致性未建立 Release 校验 |
| 上一版本真实升级 + 故意损坏回滚 | ⛔ UNVERIFIED | 缺真实签名包与分发端点 |

---

## 7. 已知限制

1. **无有效 Apple 签名身份**：无法 Developer ID 签名 / notarization / stapling；现有 DMG 为 ad-hoc，Gatekeeper 会拦截，无法在干净 Mac 直接安装。
2. **无真实外部 Provider**：本地（11434）、远程 GPU、飞书均缺服务/凭据，真实服务验收 0 项 REAL_VERIFIED。
3. **CI 尚未覆盖本次 3 个新提交**：本地命令已通过，需推送后复跑确认。
4. **自然对话指标无真实样本**：P50/P95 采集逻辑已实现，但样本量为 0，不得判定达标。
5. **`useConversationController` 仍为超大编排 hook**：多套并行状态源未完全消除（部分子控制器已拆分）。
6. **无版本 tag / 真实 Release / 更新端点**：更新闭环的端到端只到 artifact 生成，未到可分发可回滚。
7. **SBOM / 诊断包预览 / 数据库加密+Keychain / P99 尚未落地**。

---

## 8. UNVERIFIED 清单（需操作者补齐凭据/服务/硬件）

| 类别 | 缺失项 | 最短操作步骤 |
| --- | --- | --- |
| Apple 签名 | Developer ID Application 证书 | 在 https://developer.apple.com/account/resources/certificates/list 生成 → `security import <cert>.p12 -k ~/Library/Keychains/login.keychain-db`；或设置 `CODE_SIGN_IDENTITY=<certDisplayName>` |
| Apple 公证 | App Store Connect API 密钥 | https://appstoreconnect.apple.com/access/api 创建 → 设置 `APPLE_TEAM_ID`、`APPLE_NOTARY_API_KEY`、`APPLE_NOTARY_KEY_ID`、`APPLE_NOTARY_ISSUER` |
| 本地模型服务 | Ollama / LM Studio | 安装并在 127.0.0.1:11434 启动；或设置 `VOXSTUDIO_LOCAL_BASE_URL` |
| 远程 GPU 数字人 | 远程服务地址与密钥 | 设置 `VOXSTUDIO_REMOTE_BASE_URL`、`VOXSTUDIO_REMOTE_API_KEY` |
| 飞书知识库 | 应用凭证与空间 | 设置 `VOXSTUDIO_FEISHU_APP_ID`、`VOXSTUDIO_FEISHU_APP_SECRET`、`VOXSTUDIO_FEISHU_SPACE_ID` |
| 真机验收 | 干净 Mac（Apple Silicon） | 在干净 Mac 上安装已签名公证 DMG，跑首次权限/首启/升级/回滚 |
| 真实升级测试 | 上一已签名版本 + 分发端点 | 配置真实 GitHub Release 与更新 endpoint，执行升级+损坏回滚 |

---

## 9. 是否允许正式发布的明确结论

**结论：当前代码层面已达到「可进入发布准备」状态，但**不可**作为正式生产发布对外分发。**

理由：
- ✅ **CI 门禁全绿**（Python/Frontend/Rust/Security/Release gate 均 success），本地命令与 CI 一致（ruff/mypy/518 pytest/覆盖率 88.31%）。
- ✅ **安全加固显著推进**：SSRF 防护、统一脱敏、编译期更新公钥均落地并有单测。
- ⛔ 但**以下生产发布硬性前提全部未满足**，任一缺失都会阻止正式发布：
  1. **无 Developer ID 签名 / notarization / stapling** → 产物无法在目标用户机器通过 Gatekeeper；
  2. **无真实版本 tag 与 GitHub Release** → 无正式分发载体；
  3. **无真实更新端点与签名验证的端到端验收** → 更新/回滚闭环未真实验证；
  4. **真实 Provider（本地/远程/飞书）0 项 REAL_VERIFIED** → 「自然对话体验可量化」无真实样本支撑。

**给发布负责人的结论**：本版本可作为**内部 / 受控测试构建**（明确标注 UNVERIFIED），或作为**发布准备候选（Release Candidate）**。在补齐 §8 的 Apple 签名公证、真实 Provider 凭据、真实 Release 与更新端点并完成真机验收之前，**不得**将其描述为正式生产发布。

---

*报告依据：`output/readiness-baseline.md`、`output/provider-acceptance.json`、`output/release-sign-notarize.md`、`output/release-acceptance.md`、`.trae/specs/production-ready-release/`、本地门禁实测结果。*