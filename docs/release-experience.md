# 发布体验（P2）

本文档说明 VoxStudio 的发布体验能力、当前实现状态，以及上线前需要补齐的验收步骤。
每项都标注「已实现 / 仅文档化 / 未验证」，未验证的能力不会声称通过。

## 1. 版本号、构建号与 changelog

版本号在四处保持一致（当前 `0.1.0`）：

| 位置 | 文件 | 值 |
| --- | --- | --- |
| 前端 | `apps/desktop/package.json` → `version` | `0.1.0` |
| Tauri 配置 | `apps/desktop/src-tauri/tauri.conf.json` → `version` | `0.1.0` |
| Rust crate | `apps/desktop/src-tauri/Cargo.toml` → `version` | `0.1.0` |
| Sidecar | `apps/sidecar/pyproject.toml` → `version` | `0.1.0` |

- **已实现**：`CHANGELOG.md` 已建立，采用 Keep a Changelog 格式，含 `Unreleased` 段。
- **已实现**：`get_app_diagnostics`（Rust command）返回编译期 `CARGO_PKG_VERSION`，
  以及可选构建环境变量 `VOXSTUDIO_CHANNEL`（更新通道）与 `VOXSTUDIO_COMMIT`（构建提交）。
  构建泡面时通过 CI 注入这两个变量可将构建号/提交记录进诊断报告。
- **未验证**：构建号未接入 CI 产物命名与版本递增门禁（见 Task 12/14）。发布前需在 CI
  中规定「版本递增 + 刷新 changelog + 注入构建提交」的流程并验证。

## 2. 应用内更新与稳定/测试更新通道

**状态：更新生命周期已实现（含签名验证），但真实更新端点 / 签名公钥未配置，未验证。**

当前 `tauri.conf.json` **没有** `updater` 配置段，`Cargo.toml` **没有**
`tauri-plugin-updater` 依赖，因此**真实的应用内更新不可用（UNVERIFIED）**。但本次迭代
已把「带签名验证的更新生命周期」从状态机到 UI 完整落地，缺密钥时如实标注，绝不伪造通过。

### 2.1 已实现的签名更新机制（代码与单测）

- **Rust 配置面**：`apps/desktop/src-tauri/src/updater.rs` 的 `get_update_config`
  命令通过环境变量读取配置并如实上报 `configured`：
  - `VOXSTUDIO_UPDATE_PUBKEY`：URL-safe base64 的 Ed25519 公钥。
  - `VOXSTUDIO_UPDATE_ENDPOINT`：更新清单端点 URL。
  - `VOXSTUDIO_CHANNEL`：`stable` / `beta`（默认 `stable`，仅用于标注）。
  - 仅当公钥与端点**同时**存在时才 `configured = true`；否则 UI 显示「未配置」。
  - 命令已注册到 `lib.rs` 的 `invoke_handler`。
- **更新状态机**：`apps/desktop/src/features/update/updateStateMachine.ts`
  用纯 reducer 建模确定性生命周期：
  `idle → checking → available → downloading(进度) → verifying_signature → ready → installing → idle`
  及 `error` / `rolled_back` 恢复分支。非法迁移被拒绝（原状态返回），
  `INSTALL_START` 仅在签名验证通过（`signatureVerified`）后允许，篡改签名落入 `error`
  且不可重试（`isRetryable` 对 `signature_invalid` 返回 false）。
- **签名验证**：`signatureVerification.ts` 用 Web Crypto Ed25519 校验更新包签名；
  `verifySignature` 对畸形签名/密钥返回 `false`（永不抛错，作为硬性拒绝）。
  生产公钥通过 `VITE_UPDATE_PUBKEY` 注入，未配置时 `verifyUpdatePackage` 返回
  「未配置更新签名公钥（UNVERIFIED）」。
- **双通道**：`setChannel('stable'|'beta')` 仅在 `idle`/`available`/`error`/`rolled_back`
  时允许切换，下载/安装进行中被拒绝。
- **前端 UI**：`UpdatePanel.tsx` 已接入设置页（`Settings.tsx`「应用更新」区），展示
  当前版本、通道切换、检查/下载进度/签名验证/安装动作，签名未验证前不出现「安装」按钮。
- **单测**：`updateStateMachine.test.ts`（12 例）、`signatureVerification.test.ts`（6 例）、
  `UpdatePanel.test.tsx`（4 例），全部通过。

### 2.2 真实更新接线（发布前需完成，当前 UNVERIFIED）

Tauri v2 的更新原理：`tauri-plugin-updater` 在启动时请求一个 JSON 端点（如
`https://updates.example.com/{{target}}/{{arch}}/{{current_version}}`），端点返回
最新版本、下载 URL 与签名（`signature`），应用下载固件包并校验公钥后安装。要真正启用：

1. 在 `apps/desktop/src-tauri/Cargo.toml` 增加
   `tauri-plugin-updater = { version = "2", features = ["javascript"] }`。
2. 在 `tauri.conf.json` 增加 `plugins.updater` 段：
   - `pubkey`：Tauri 签名公钥（`tauri signer generate` 生成）。
   - `endpoints`：指向更新清单端点。
   - `windows.installMode` / `macOS` 相关安装策略。
3. 前端创建 `Update` 插件实例，把 `updateClient.ts` 的
   `checkForUpdates` / `downloadUpdate` / `verifyUpdate` / `installUpdate` 从
   「未接通（UNVERIFIED）」实现替换为真实插件调用。
4. **区分通道**：为不同通道提供不同端点（如 `.../stable/...` 与 `.../beta/...`），
   或用 `endpoints` 覆盖 + 版本号规则。当前 `VOXSTUDIO_CHANNEL` 仅驱动 UI 通道选择，
   不驱动真实端点选择。

**验收清单（发布前需逐项执行并记录证据）：**
- [ ] 生成签名密钥对，公钥写入 `tauri.conf.json`，私钥安全存放于 CI Secret。
- [ ] 部署更新清单端点（HTTP 200 + JSON schema 正确）。
- [ ] 构建并签名新版本，`tauri build` 产物通过 `codesign` 与 notarization。
- [ ] 主程序（旧版）启动后能拉取到更新清单并下载新版本。
- [ ] 安装新版本后重启，版本号正确刷新。
- [ ] 稳定通道只推送稳定版本，测试通道推送预发布版本，互不串扰。
- [ ] 更新失败（断网/签名不匹配）时给出可读提示且不破坏当前版本。
- [ ] 篡改更新包签名被硬性拒绝（`signature_invalid`，不触发安装）。

> 由于缺少签名公钥、更新端点与签名凭证，真实更新端到端流程**均未验证**；
> 已落地的仅是生命周期状态机、签名验证原语与 UI，缺密钥时如实标注 UNVERIFIED。

## 3. 数据库迁移备份与回滚

**已实现。** `apps/sidecar/src/voxstudio_core/persistence/database.py` 的
`migrate()` 在应用任何待执行迁移前，若数据库已含真实应用表，会先把当前数据库复制为
`<name>.bak.<目标版本>`（例如 `readiness.sqlite3.bak.13`）。空库或无需迁移时跳过。

- 触发条件：存在待执行迁移 **且** 数据库已包含非 `schema_migrations` 的应用表。
- 限制：副本为离线文件复制，数据库使用默认 rollback journal（非 WAL），
  复制时无写事务在途，故为一致快照。
- 单测：`apps/sidecar/tests/unit/persistence/test_database_backup.py`（3 例，已通过）。

**回滚策略（手动）：**
1. 退出 VoxStudio（确保 sidecar 已停止）。
2. 在应用数据目录中，将 `readiness.sqlite3` 替换为最近的
   `readiness.sqlite3.bak.<版本>`。
3. 重新启动应用，sidecar 会以旧 schema 运行。

**验收清单：**
- [ ] 用旧版本数据库启动新版应用，确认迁移前生成 `.bak.<版本>`。
- [ ] 模拟一次因迁移失败导致的启动失败，按上述回滚步骤恢复后数据完整。
- [ ] 确认空库/全新安装不生成多余 `.bak` 文件。

## 4. 崩溃与 Sidecar 退出诊断

**已实现。** `apps/desktop/src-tauri/src/sidecar.rs` 新增共享的
`SidecarDiagnosticsState`，sidecar 监督线程在每次异常退出时记录退出码，在自动重启、
重启预算耗尽（fail-closed）或启动/探活失败时更新崩溃标记与最近错误。`lib.rs` 的
`get_app_diagnostics` 命令返回这些信息（不含任何令牌）。

- 前端「设置 → 诊断」面板展示：Sidecar 连接状态、是否曾崩溃、自动重建次数、
  最近退出码、最近错误。
- 注意：Tauri 侧当前将 sidecar 的 stdout/stderr 置为 `null`
  （`sidecar.rs` `TauriProcessRunner::spawn`），因此不会捕获 sidecar 自身的日志流；
  崩溃取证主要依赖退出码与错误码。若需完整日志，请在 sidecar 侧落地文件日志后再接入。

**验收清单：**
- [ ] 手动 kill sidecar 进程，确认诊断面板显示退出码与「曾崩溃」，且自动重建一次。
- [ ] 连续 kill 两次以上，确认进入 fail-closed 并显示对应错误。
- [ ] 确认诊断信息不包含 Bearer 令牌。

## 5. 可导出诊断包

**已实现（最小版）。** 前端「设置 → 诊断」面板提供「导出诊断报告」按钮，复用既有的
`save_text_file`（原生保存对话框）生成 `.txt` 诊断包，内容包含：应用版本、更新通道、
构建提交、数据目录、Sidecar 连接与退出诊断、配置摘要（仅布尔「是否已保存」标记与
非敏感 URL/模型名）。**不含任何密钥/令牌**。

- 报告组装为纯函数 `buildDiagnosticReport`（`src/features/diagnostics/diagnosticReport.ts`），
  单测覆盖「不泄漏密钥」。
- 导出入口：`src/features/diagnostics/DiagnosticsPanel.tsx`。

**后续可选（未实现）：** 将日志文件、数据库迁移版本、readiness 快照一并打包为 zip。

## 6. 隐私开关与数据删除说明

**已实现（说明文案）。** 「设置 → 隐私与数据」面板补充「数据发送范围」与「数据删除」说明：
- 明确哪些数据、何时发送到远程 provider（对话/语音/头像请求、知识同步）。
- 明确密钥仅存于系统钥匙串，不随请求发送，也不出现在诊断报告。
- 说明清空本地数据/重置设置的删除范围，以及远程 provider/飞书云端数据需另行删除。

**未实现（能力缺口）：** 尚无「禁用远程 provider 的隐私开关」。当前做法是「不配置远程
地址/不保存密钥」即等效不发送远程数据。若需要显式开关，需在设置中新增布尔项并接线到
`provider_environment`。

## 安全边界

- 诊断信息与导出报告均不包含 Bearer 令牌、API Key、App Secret、Access/Refresh Token。
- 更新公钥私钥分离，私钥不出 CI。

## 7. 首次权限申请（相机 / 麦克风 / Keychain）

**状态：未验证（缺干净 Mac 与真实 TCC 交互）。** 应用在 `Info.plist` 声明
`NSCameraUsageDescription` 与 `NSMicrophoneUsageDescription`（中文用途说明），
`release-closure.sh` 会校验这两项是否存在。密钥经 `keyring` crate 存入登录钥匙串
（service 名 `io.voxstudio.desktop`），首次保存会自动请求钥匙串访问。

**验收（干净 Mac，真实 GUI 会话）：**
1. 从 DMG 拖入 `/Applications` 后首次启动。
2. 触发「拍摄人像」→ 出现相机授权弹窗 → 点「允许」。确认 `NSCameraUsageDescription`
   文案正确显示。
3. 触发「录制声音样本」→ 出现麦克风授权弹窗 → 点「允许」。
4. 保存任一 provider 密钥 → 确认无「钥匙串已被锁定」错误；
   `security find-generic-password -s io.voxstudio.desktop` 可检索到条目。
5. 拒绝授权后应用不崩溃，能给出可读提示。

**回滚 / 重置：** 系统设置 → 隐私与安全性 → 相机/麦克风移除 VoxStudio；钥匙串访问
「钥匙串访问.app」删除 `io.voxstudio.desktop` 条目。

## 8. 断网启动与网络中断恢复

**状态：未验证（真实断网）。** `release-closure.sh --offline` 在具备免密 sudo 时
才会真正 `ifconfig en0 down` 后启动 app 验证；否则输出 UNVERIFIED 与 runbook。
本机 smoke 证明打包 app + sidecar 可在带网环境启动。

**验收（目标机）：**
```bash
sudo ifconfig en0 down
open -a VoxStudio
# 预期：app + sidecar 正常启动，无 provider 调用挂起；界面不卡死
sudo ifconfig en0 up
```
- 断网时「准备工作室」与本地 readiness 仍可用；远程 provider 调用应失败并给出可读错误，
  而非无限等待。
- 断网后恢复网络，进行中的构建任务应能续查（前端 `useBuildJobPolling` 轮询退避/续查）。

**回滚：** 无状态变更，断网/恢复网络即可；若异常卡死，`killall VoxStudio voxstudio-desktop digital-human-sidecar`。

## 9. 覆盖升级与旧数据升级

**状态：未验证（真实升级）。** 数据库迁移自带备份（第 3 节）：升级启动时若存在待执行
迁移且已有应用表，会先复制为 `readiness.sqlite3.bak.<版本>`。数据目录
`~/Library/Application Support/io.voxstudio.desktop`。

**验收（真实覆盖安装）：**
1. 保留数据目录，将新版 DMG 拖入 `/Applications` 覆盖旧版。
2. 启动新版 → 确认数据库迁移执行并在升级前生成 `.bak.<版本>`。
3. 确认会话、设置、已保存密钥（钥匙串）均保留。
4. 版本号刷新为 `0.1.x`（四处一致）。

**回滚（手动）：** 退出 VoxStudio → 将 `readiness.sqlite3` 替换为最近的
`readiness.sqlite3.bak.<版本>` → 重启，sidecar 以旧 schema 运行。

## 10. 卸载清理

**状态：未验证（真实安装环境）。** 卸载为纯手动删除 + 钥匙串清理。

**验收 / 清理步骤：**
1. 退出 VoxStudio（确认无 sidecar 残留进程）。
2. 删除 `/Applications/VoxStudio.app`。
3. 删除数据目录 `~/Library/Application Support/io.voxstudio.desktop`。
4. 删除钥匙串条目：钥匙串访问 → 删除 `io.voxstudio.desktop`。
5. 确认无残留进程：`pgrep -fl 'VoxStudio|voxstudio-desktop|digital-human-sidecar'` 为空。

**回滚：** 重装 DMG 即可；数据目录与钥匙串条目删除后不可恢复，需在删除前备份。

## 11. 崩溃清理与自动恢复

**状态：部分实现 / 真实崩溃未验证。** `sidecar.rs` 的 `SidecarDiagnosticsState` 记录
sidecar 异常退出码、自动重建次数与 fail-closed 标记；前端「设置 → 诊断」展示。崩溃时
临时资源（`$TEMP/voxstudio-portrait-*`、`voxstudio-recording-*`）由系统临时目录清理，
sidecar 监督线程负责重启/关闭。

**验收（目标机）：**
1. `killall voxstudio-desktop`（主程序崩溃）→ 确认无残留 sidecar 进程，重启后可用。
2. `killall digital-human-sidecar`（sidecar 崩溃）→ 诊断面板显示退出码与「曾崩溃」，
   且自动重建一次。
3. 连续 kill 两次以上 → 进入 fail-closed 并显示对应错误。
4. 确认 `$TEMP` 下临时人像/录音资源在重启后无堆积。

**回滚：** fail-closed 后重启应用即可重新拉起 sidecar；无需手动清理（临时资源在系统
tmp 自动回收）。