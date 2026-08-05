# Tasks

## Task 1: 移除占位生产配置并实现 fails-closed 注入策略
- [x] `tauri.conf.json` 的 `plugins.updater.pubkey` 改为明确的开发占位符
      `VOXSTUDIO_DEVEL_PLACEHOLDER_INJECT_PRODUCTION_VIA_VOXSTUDIO_UPDATE_PUBKEY`
- [x] `plugins.updater.endpoints` 置空 `[]`（fails-closed）
- [x] 文档化生产值通过 `VOXSTUDIO_UPDATE_PUBKEY` / `VOXSTUDIO_UPDATE_ENDPOINT_STABLE` /
      `VOXSTUDIO_UPDATE_ENDPOINT` 注入；缺失时 `configured=false` 且不提供更新

## Task 2: 签名/公证状态来自真实工具校验
- [x] 新增 `scripts/verify-release.sh`：`codesign --verify --deep --strict` +
      `spctl --assess --type execute`，有公证凭证时 `notarytool submit --wait` +
      `stapler staple/validate`
- [x] 输出诚实 `output/verify.json`，`status` ∈ `notarized|signed|unsigned|unverified`
      （仅来自真实工具输出，绝不因凭证存在而声称已签名/公证）

## Task 3: CI release-gate 真实运行校验与诚实门禁
- [x] `ci.yml` `release-gate` 运行 `verify-release.sh` + `release-provenance.sh`
- [x] 有签名凭证时：`verify.json` status 非 `notarized`/`signed` 则 `RELEASE GATE FAILED`
      并使流水线失败
- [x] 无凭证时输出显式 UNVERIFIED 标记，绝不声称发布

## Task 4: 产物溯源诚实化
- [x] `scripts/release-provenance.sh` 的 `sign_status` 仅来自真实 `verify.json`，不回退到凭证存在
- [x] `scripts/release-dmg.sh` 在签名+公证+stapling 后自动生成溯源

## Task 5: 增加聚焦测试
- [x] Rust：manifest 解析（合法/非法 JSON/缺 version/缺 platforms）
- [x] Rust：Ed25519 签名校验（合法通过、篡改/异钥/畸形拒绝）
- [x] Rust：签名失败→`signature_invalid`、安装 IO 失败→`install_failed` 错误映射
- [x] Python：迁移失败留可恢复 `.bak` 且失败迁移不记录为已应用（rollback 测试）

## Task 6: 更新文档
- [x] `docs/release-checklists.md` 记录 verify/provenance/release-gate 工作流与 fails-closed 注入策略
- [x] `CHANGELOG.md` 在 Unreleased 记录真实更新闭环、真实校验门禁、产物溯源、fails-closed 配置

## Task 7: 验证与提交
- [x] `cargo test`（apps/desktop/src-tauri）通过（17 lib + 集成全绿）
- [x] `cargo clippy --all-targets --all-features -- -D warnings` 通过
- [x] `cargo audit` 通过（仅既有 allowed warnings，无漏洞）
- [x] `pytest apps/sidecar/tests`（含迁移备份/回滚测试）通过（56 passed）
- [x] `bash -n scripts/verify-release.sh scripts/release-provenance.sh` 语法自检
- [x] `cargo fmt -- --check` 通过
- [x] 提交并推送到 `origin/main`

# Task Dependencies
- [Task 2] depends on [Task 1]（fails-closed 验证脚本依赖产物）
- [Task 3] depends on [Task 2]（gate 消费 verify.json）
- [Task 4] depends on [Task 2]（溯源消费 verify.json）
- [Task 5]/[Task 6] 可与 [Task 2]/[Task 3] 并行
- [Task 7] depends on 全部

## 并行可执行
- [Task 1] 独立
- [Task 5]/[Task 6] 独立可并行
- [Task 2]/[Task 3]/[Task 4] 串行依赖