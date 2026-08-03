# @voxstudio/desktop

VoxStudio 的桌面前端与 Rust 壳，基于 **Tauri 2 + React 19 + TypeScript + Vite**。

## 目录

```text
src/           React/TS 前端源码（含组件、hooks、状态）
src-tauri/     Rust shell：readiness 契约、sidecar 监管、媒体校验、capture 权限
dist/          前端构建产物（由 vite build 生成，不入库）
index.html     Vite 入口
```

## 脚本

```bash
pnpm dev            # 启动 Vite 开发服务器
pnpm build          # tsc --noEmit + vite build
pnpm test           # vitest run
pnpm tauri dev      # 启动 Tauri 开发（拉起前端 + Rust shell + sidecar）
pnpm tauri build    # 构建 release DMG
```

> 上层统一入口见仓库根 `package.json`（`pnpm --dir apps/desktop ...`）。
> sidecar 二进制通过 `Tauri.externalBin` 从 `src-tauri/binaries/` 解析。

## 说明

- 开发期 Vite 运行在 `http://127.0.0.1:1420`。
- `src-tauri/target/` 为 Rust 编译产物（约 12G），已被根 `.gitignore` 忽略。
