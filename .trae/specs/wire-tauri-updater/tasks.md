# Tasks

- [x] Task 1: 配置 tauri.conf.json 与能力权限
  - [x] 在 `bundle` 中新增 `"createUpdaterArtifacts": true`
  - [x] 新增 `plugins.updater` 段：`pubkey` 用占位符（标注需注入真实公钥）、`endpoints` 用占位符数组
  - [x] 在 `capabilities/default.json` 的 `permissions` 中新增 `updater:default`
  - [x] 确认 `Cargo.toml` 已含 `tauri-plugin-updater` 与 `url` 依赖

- [x] Task 2: Rust 后端接入真实 updater 插件与命令
  - [x] 在 `updater.rs` 增加按通道解析端点的辅助函数（`VOXSTUDIO_UPDATE_ENDPOINT_STABLE` / `VOXSTUDIO_UPDATE_ENDPOINT`），缺失时视为未配置
  - [x] 实现 `update_check(app, channel)`：用 `app.updater()?.endpoints([...]).check()` 返回 `{ available, version }`；未配置/失败返回结构化错误
  - [x] 实现 `update_download(app, channel, on_progress: Channel)`：下载更新包并通过 Channel 上报进度，将进行中的 `Update` 存入受管状态
  - [x] 实现 `update_install(app)`：安装已下载更新包并 `app.restart()`
  - [x] 保留/调整 `get_update_config`，使 `configured` 与真实插件一致
  - [x] 为端点解析与配置逻辑补充 Rust 单元测试
  - [x] 在 `lib.rs` 注册 updater 插件（`tauri_plugin_updater::Builder`）、管理更新状态、暴露新命令

- [x] Task 3: 前端接入真实命令
  - [x] `updateClient.ts`：`checkForUpdates` / `downloadUpdate` / `installUpdate` 改为 `invoke` 真实 Rust 命令；`verifyUpdate` 交由插件签名校验；保留 `UpdateError` 映射与 `not_configured` 语义
  - [x] `useUpdateManager.ts`：驱动真实命令，接入下载进度回调
  - [x] 更新/补齐 `UpdatePanel.test.tsx` 等前端测试（契约变化处）

- [x] Task 4: 验证
  - [x] `cargo test`（含新增 Rust 单元测试）通过
  - [x] `cargo check` / `cargo build` 通过
  - [x] `pnpm tsc --noEmit` 通过
  - [x] `pnpm vitest run src/features/update` 通过

# Task Dependencies
- [Task 2] depends on [Task 1]（配置与能力权限先行）
- [Task 3] depends on [Task 2]（前端调用真实命令）
- [Task 4] depends on [Task 2]、[Task 3]

## 并行可执行
- [Task 1] 独立
- [Task 2] 在 [Task 1] 后可执行
- [Task 3] 在 [Task 2] 后可执行