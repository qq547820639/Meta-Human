# 脚本说明

本目录收录构建、校验、冒烟测试与发布脚本。所有脚本从仓库根目录调用。

## 构建

| 脚本 | 作用 |
| --- | --- |
| `build-sidecar.sh` | 用 Nuitka 打包 sidecar，产物写入 `apps/desktop/src-tauri/binaries/digital-human-sidecar-<host-triple>` |
| `build-sidecar-x86_64.sh` | 用 Nuitka 打包 x86_64 版本 sidecar（交叉编译前置） |
| `build-universal.sh` | 构建并校验同时包含 `arm64` + `x86_64` 的通用二进制与通用 DMG |

## 校验 / 门禁

| 脚本 | 作用 |
| --- | --- |
| `verify-foundation.sh` | 运行全部依赖检查与自动化门禁（缺工具或 sidecar 即失败） |
| `verify-release-readiness.sh` | 列出发布先决条件与缺失项 |

## 冒烟测试

| 脚本 | 作用 |
| --- | --- |
| `smoke-providers.sh` | 报告当前可用的真实 provider 冒烟路径 |
| `smoke-capture.sh` | 报告主机是否具备摄像头与麦克风设备 |
| `smoke-dmg.sh` | 挂载、启动、校验并退出打包后的 DMG |
| `smoke-mock-provider.py` | 用本地 mock 的 local/remote/Feishu provider 跑完整 readiness 冒烟 |

## 发布

| 脚本 | 作用 |
| --- | --- |
| `release-dmg.sh` | 构建、签名、公证并 staple DMG（需 Apple 发布凭证） |

## 报告（写入 output/）

| 脚本 | 写入产物 |
| --- | --- |
| `record-dmg-smoke.sh` | 打包 DMG 冒烟报告 |
| `record-mock-smoke.sh` | mock provider 端到端冒烟报告 |
| `record-provider-readiness.sh` | provider 冒烟就绪报告 |
| `record-release-readiness.sh` | 发布就绪报告 |

## 常用组合

```bash
# 本地开发前完整自检
scripts/verify-foundation.sh

# 打包并本地冒烟
scripts/build-sidecar.sh
pnpm --dir apps/desktop tauri build
scripts/smoke-dmg.sh
```
