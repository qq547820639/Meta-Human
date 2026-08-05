# 正式接入 Tauri updater 插件 Spec

## Why
桌面应用当前只有「前端模拟更新 UI」：`updateClient.ts` 的 `checkForUpdates` / `downloadUpdate` / `installUpdate`
实现均为「honest fail」桩，`updater.rs` 的文档注释也明确写明「real in-app updater (`tauri-plugin-updater`) is not wired into this build yet」。
应用内更新必须接入真实 `tauri-plugin-updater`，才能完成真实签名校验、下载、安装与重启，替换掉模拟 UI。

## What Changes
- **Cargo.toml**：保留已添加的 `tauri-plugin-updater = "2"` 与 `url = "2"` 依赖。
- **tauri.conf.json**：新增 `bundle.createUpdaterArtifacts = true` 与 `plugins.updater` 段（`pubkey` 用占位符并在文档标注需注入真实公钥，`endpoints` 用占位符）。由于 `tauri.conf.json` 是静态 JSON 无法读取环境变量，真实的 stable/beta 端点由 Rust 在运行时从环境变量解析。
- **capabilities/default.json**：新增 `updater:default` 权限。
- **src-tauri/src/updater.rs**：注册真实 updater 插件；按通道从环境变量解析端点（`VOXSTUDIO_UPDATE_ENDPOINT_STABLE` / `VOXSTUDIO_UPDATE_ENDPOINT`）；实现 `update_check` / `update_download` / `update_install` 命令并管理进行中的 `Update`；保留 `get_update_config`；补充单元测试。
- **src-tauri/src/lib.rs**：注册 updater 插件、管理更新状态、暴露新命令。
- **src/features/update/updateClient.ts**：把 `checkForUpdates` / `downloadUpdate` / `installUpdate` 从 honestly-fail 桩改为调用真实 Rust 命令；`verifyUpdate` 改为交由插件签名校验（插件内置 pubkey 校验 .sig），并保留 `not_configured` / 错误映射。
- **src/features/update/useUpdateManager.ts**：驱动真实命令，接入下载进度回调。
- **测试**：更新前端 update 相关测试、补充 Rust 单元测试，验证 `cargo test` / `tsc` / `vitest`。

## Impact
- Affected specs：`update` 能力（`updateClient`、`useUpdateManager`、`UpdatePanel`、`updateStateMachine`、`signatureVerification`）。
- Affected code：
  - `apps/desktop/src-tauri/Cargo.toml`
  - `apps/desktop/src-tauri/tauri.conf.json`
  - `apps/desktop/src-tauri/capabilities/default.json`
  - `apps/desktop/src-tauri/src/updater.rs`
  - `apps/desktop/src-tauri/src/lib.rs`
  - `apps/desktop/src/features/update/updateClient.ts`
  - `apps/desktop/src/features/update/useUpdateManager.ts`
  - `apps/desktop/src/features/update/UpdatePanel.test.tsx`（如契约变化）

## ADDED Requirements

### Requirement: 真实 updater 插件注册
系统 SHALL 在桌面端启动时注册 `tauri-plugin-updater` 插件，并授予 `updater:default` 能力权限。

#### Scenario: 插件随应用启动
- **WHEN** 应用通过 `tauri::Builder` 构建
- **THEN** updater 插件已在 `setup` 中注册，`app.updater()` 可用

### Requirement: 按通道解析更新端点
系统 SHALL 在运行时根据更新通道从环境变量解析更新端点：
- stable → `VOXSTUDIO_UPDATE_ENDPOINT_STABLE`
- beta → `VOXSTUDIO_UPDATE_ENDPOINT`

#### Scenario: 端点缺失时报告未配置
- **WHEN** 给定通道对应环境变量为空
- **THEN** 检查/下载命令返回 `not_configured` 错误，UI 保持「未配置」

### Requirement: 真实检查更新
系统 SHALL 提供 `update_check` 命令，使用当前通道端点调用 `app.updater()?.check()`，返回是否可用及可用版本。

#### Scenario: 检查到新版本
- **WHEN** 用户点击「检查更新」且端点可用
- **THEN** 返回 `{ available: true, version: "0.2.0" }`，UI 进入 available 态

#### Scenario: 端点异常
- **WHEN** 端点请求失败（网络/非 2XX）
- **THEN** 命令返回结构化错误，UI 进入 error 态并允许重试

### Requirement: 真实下载与签名校验
系统 SHALL 提供 `update_download` 命令，通过插件下载更新包（内置公钥校验 `.sig` 签名），并通过 `tauri::ipc::Channel` 上报进度。

#### Scenario: 下载进度上报
- **WHEN** 下载进行中
- **THEN** 前端收到 `downloadedBytes` / `totalBytes` 进度事件并展示进度条

#### Scenario: 签名校验失败
- **WHEN** 下载包签名无法通过内置公钥验证
- **THEN** 命令返回 `signature_invalid` 错误，UI 进入 error 态且不提供安装动作

### Requirement: 真实安装与重启
系统 SHALL 提供 `update_install` 命令安装已验证的更新包并重启应用。

#### Scenario: 安装成功
- **WHEN** 用户点击「安装更新」且更新包已下载并校验
- **THEN** 安装完成并 `app.restart()`

## MODIFIED Requirements

### Requirement: get_update_config 反映真实插件
现有 `get_update_config` 命令保留，但 `configured` 语义需与真实插件一致：当且仅当对应通道端点环境变量与签名公钥均配置时才为 true。

## REMOVED Requirements

### Requirement: 前端模拟(check/download/install 桩)
**Reason**：`updateClient.ts` 中 `checkForUpdates` / `downloadUpdate` / `installUpdate` 的 honestly-fail 桩被真实插件调用取代。
**Migration**：前端继续调用同名函数，但实现改为 `invoke` 真实 Rust 命令；`updateStateMachine` 状态机与 `UpdatePanel` 交互保持不变。