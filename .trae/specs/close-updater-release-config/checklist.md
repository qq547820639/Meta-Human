# Checklist：关闭真实更新 + 发布配置闭环

- [x] `tauri.conf.json` 无真实生产 pubkey/endpoint；占位符 + 空 endpoints，缺失时 fails-closed
- [x] `scripts/verify-release.sh` 用真实 codesign/spctl/notarytool/stapler 验证，输出诚实 `verify.json`
- [x] `ci.yml` `release-gate` 实际运行 verify + provenance；有凭证时真实验证失败则判失败；无凭证输出 UNVERIFIED
- [x] `scripts/release-provenance.sh` 的 `sign_status` 仅来自真实 `verify.json`，不因凭证存在声称已签名/公证
- [x] Rust 单元测试覆盖 manifest 解析、Ed25519 签名校验（接受/篡改/异钥/畸形）、错误映射
- [x] Python 测试覆盖迁移前备份与失败回滚（`.bak` 可恢复、失败迁移不记为已应用）
- [x] `docs/release-checklists.md` 与 `CHANGELOG.md` 记录新工作流与 fails-closed 注入策略
- [x] `cargo test` 通过
- [x] `cargo clippy --all-targets --all-features -- -D warnings` 通过
- [x] `cargo audit` 通过
- [x] `pytest apps/sidecar/tests` 通过（含迁移备份/回滚测试）
- [x] 变更已提交并推送到 `origin/main`