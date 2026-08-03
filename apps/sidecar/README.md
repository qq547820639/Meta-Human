# voxstudio-core（sidecar）

VoxStudio 的 Python **FastAPI sidecar**，运行真实的有界能力校验、知识检索、
对话与持久化，并通过仅回环（loopback）的 API 对外服务。

## 目录

```text
src/voxstudio_core/   API、readiness 服务、持久化、安全
tests/                pytest 单元测试 + 集成测试
dist/                 构建产物（不入库）
pyproject.toml        uv 管理的项目元数据与依赖
uv.lock               锁定依赖
```

## 依赖与环境

- Python 3.12（`requires-python = ">=3.12,<3.13"`）
- 运行依赖：`aiosqlite`、`fastapi`、`pydantic`、`uvicorn`
- 开发依赖（uv dev group）：`httpx`、`pytest`、`pytest-asyncio`
- 包管理使用 **uv**。

## 常用命令

```bash
uv sync --project apps/sidecar                 # 同步环境
uv run --project apps/sidecar pytest apps/sidecar/tests -q   # 运行测试
scripts/build-sidecar.sh                        # 用 Nuitka 打包为自包含二进制
```

## 安全边界

- 仅监听回环地址，受每次启动随机生成的 bearer token 保护（经进程环境传递）。
- 未配置的能力返回 `action_required`，而非伪造通过。
- token 不持久化、不记录日志、不接受来自 query string。
