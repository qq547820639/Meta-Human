# VoxStudio 测试矩阵报告

- 提交: `07e5af7ef91ad7ef262e37f9fc668f4670a89332`
- 分支: `main`
- 版本: `0.1.0`
- 机器: `27.0 (26A5388g) arm64`
- 时间戳: `2026-08-06T07:07:20Z`
- 工具链: node v26.5.1 / pnpm 11.9.0 / uv uv 0.11.28 (ebf0f43d7 2026-07-07 aarch64-apple-darwin) / rustc rustc 1.97.1 (8bab26f4f 2026-07-14)

## 汇总

| 状态 | 数量 |
|---|---|
| PASS | 9 |
| FAIL | 0 |
| UNVERIFIED | 7 |

## 明细

| 项目 | 分类 | 状态 | 耗时(ms) | 证据文件 |
|---|---|---|---|---|
| sidecar-crash | crash | PASS | 2918 | output/test-matrix/evidences/sidecar-crash.log |
| no-network | network | PASS | 7510 | output/test-matrix/evidences/no-network.log |
| db-migration | migration | PASS | 160 | output/test-matrix/evidences/db-migration.log |
| session-pagination | session | PASS | 271 | output/test-matrix/evidences/session-pagination.log |
| multi-session | session | PASS | 205 | output/test-matrix/evidences/multi-session.log |
| multi-human | device | PASS | 238 | output/test-matrix/evidences/multi-human.log |
| offline-queue | network | PASS | 2452 | output/test-matrix/evidences/offline-queue.log |
| disk-full | disk | PASS | 116 | output/test-matrix/evidences/disk-full.log |
| permission | permission | PASS | 666 | output/test-matrix/evidences/permission.log |
| clean-mac-first-install | install | UNVERIFIED | 0 | output/test-matrix/evidences/clean-mac-first-install.log |
| intel-mac | install | UNVERIFIED | 0 | output/test-matrix/evidences/intel-mac.log |
| overlay-upgrade | upgrade | UNVERIFIED | 0 | output/test-matrix/evidences/overlay-upgrade.log |
| downgrade-block | upgrade | UNVERIFIED | 0 | output/test-matrix/evidences/downgrade-block.log |
| update-failure | upgrade | UNVERIFIED | 0 | output/test-matrix/evidences/update-failure.log |
| airpods-headset | device | UNVERIFIED | 0 | output/test-matrix/evidences/airpods-headset.log |
| system-sleep-wake | power | UNVERIFIED | 0 | output/test-matrix/evidences/system-sleep-wake.log |

注: UNVERIFIED 表示需要真实硬件/凭据/分发端点，本次未实际验证，绝不伪造为 PASS。
