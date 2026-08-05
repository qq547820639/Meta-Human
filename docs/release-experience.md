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

**状态：未配置 / 未验证。** 当前 `tauri.conf.json` **没有** `updater` 配置段，
`Cargo.toml` **没有** `tauri-plugin-updater` 依赖，因此应用内更新不可用。

Tauri v2 的更新原理：`tauri-plugin-updater` 在启动时请求一个 JSON 端点（如
`https://updates.example.com/{{target}}/{{arch}}/{{current_version}}`），端点返回
最新版本、下载 URL 与签名（`signature`），应用下载固件包并校验公钥后安装。

要启用稳定/测试通道，需要：

1. 在 `apps/desktop/src-tauri/Cargo.toml` 增加
   `tauri-plugin-updater = { version = "2", features = ["javascript"] }`。
2. 在 `tauri.conf.json` 增加 `plugins.updater` 段：
   - `pubkey`：Tauri 签名公钥（`tauri signer generate` 生成）。
   - `endpoints`：指向更新清单端点。
   - `windows.installMode` / `macOS` 相关安装策略。
3. 前端创建 `Update` 插件实例，接入「检查更新 / 下载 / 提示重启」UI。
4. **区分通道**：为不同通道提供不同端点（如 `.../stable/...` 与 `.../beta/...`），
   或通过 `endpoints` 覆盖 + 版本号规则。当前 Rust 中的 `VOXSTUDIO_CHANNEL`
   仅用于诊断标注，不驱动更新端点选择。

**验收清单（发布前需逐项执行并记录证据）：**
- [ ] 生成签名密钥对，公钥写入 `tauri.conf.json`，私钥安全存放于 CI Secret。
- [ ] 部署更新清单端点（HTTP 200 + JSON schema 正确）。
- [ ] 构建并签名新版本，`tauri build` 产物通过 `codesign` 与 notarization。
- [ ] 主程序（旧版）启动后能拉取到更新清单并下载新版本。
- [ ] 安装新版本后重启，版本号正确刷新。
- [ ] 稳定通道只推送稳定版本，测试通道推送预发布版本，互不串扰。
- [ ] 更新失败（断网/签名不匹配）时给出可读提示且不破坏当前版本。

> 由于缺少签名公钥、更新端点与签名凭证，以上均未验证。

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