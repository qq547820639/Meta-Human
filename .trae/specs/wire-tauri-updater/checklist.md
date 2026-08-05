# Checklist

- [x] `tauri.conf.json` 包含 `plugins.updater`（占位 pubkey + 占位 endpoints）与 `bundle.createUpdaterArtifacts`
- [x] `capabilities/default.json` 包含 `updater:default` 权限
- [x] `Cargo.toml` 含 `tauri-plugin-updater` 与 `url` 依赖
- [x] `updater.rs` 注册真实插件并实现 `update_check` / `update_download` / `update_install` 命令与按通道端点解析
- [x] `lib.rs` 注册 updater 插件、管理更新状态、暴露新命令
- [x] `updateClient.ts` 的 check/download/install 调用真实 Rust 命令，`verifyUpdate` 交由插件签名校验
- [x] `useUpdateManager.ts` 驱动真实命令并接入下载进度
- [x] Rust 单元测试覆盖端点解析与配置逻辑
- [x] `cargo test` / `cargo check` / `pnpm tsc --noEmit` / `pnpm vitest run src/features/update` 通过