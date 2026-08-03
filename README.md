# VoxStudio（元人 / Meta-Human）

VoxStudio 是一款 **macOS 优先** 的桌面应用，帮助用户塑造并对话自己的「数字人」。
应用基于 **Tauri 2 + React/TypeScript** 前端，配合一个 **Python 3.12 FastAPI sidecar**
提供真实能力校验、知识检索与对话服务。

产品当前切片实现了一个「准备门禁（readiness gate）」：在解锁数字人创建前，
`能够对话`、`能够听说和呈现`、`能够使用知识` 三项能力必须全部通过真实校验。

## 仓库结构

```text
apps/
  desktop/        Tauri 2 + React + TypeScript 前端（含 Rust shell）
    src/          React/TS 前端源码
    src-tauri/    Rust shell、readiness 契约、sidecar 监管
  sidecar/        Python FastAPI sidecar（能力校验 / 持久化 / 安全）
docs/
  development.md  开发指南（环境、架构、配置、排障）
  release-checklists.md  签名 DMG 发布清单
  plans/          TDD 实现计划（按日期归档）
scripts/          构建 / 冒烟测试 / 发布脚本
output/           构建产物与冒烟测试报告（*.dmg 等大文件不入库）
```

> 完整的开发流程、配置项、架构与安全边界见 [docs/development.md](docs/development.md)。
> 文档索引见 [docs/README.md](docs/README.md)，脚本用途见 [scripts/README.md](scripts/README.md)。

## 技术栈

| 层 | 技术 |
| --- | --- |
| 桌面壳 | Tauri 2（Rust） |
| 前端 | React 19 + TypeScript + Vite |
| 后端 sidecar | Python 3.12 + FastAPI |
| 打包 | Nuitka（sidecar）、Tauri bundle（DMG） |
| 包管理 | pnpm（前端）、uv（Python） |

## 先决条件

- macOS on Apple Silicon（host triple `aarch64-apple-darwin`）
- Node.js + pnpm 11
- Rust stable（含 `rustfmt`、`clippy`）
- uv（管理 Python 3.12 环境）

## 快速开始

```bash
# 1. 安装前端依赖
pnpm install

# 2. 同步 Python sidecar 环境
uv sync --project apps/sidecar

# 3. 用 Nuitka 打包 sidecar（构建产物放入 apps/desktop/src-tauri/binaries）
scripts/build-sidecar.sh

# 4. 启动开发模式（Tauri 会拉起 Vite + Rust shell + sidecar）
pnpm --dir apps/desktop tauri dev
```

构建 release 风格的本地包：

```bash
pnpm --dir apps/desktop tauri build
```

## 校验与测试

一键运行所有自动化门禁（工具链检查 + 单测 + 构建 + lint）：

```bash
scripts/verify-foundation.sh
```

## 文档与发布

- 开发指南：[docs/development.md](docs/development.md)
- 发布清单：[docs/release-checklists.md](docs/release-checklists.md)
- 实现计划：[docs/plans/](docs/plans/)

## 许可

详见仓库 LICENSE（待补充）。
