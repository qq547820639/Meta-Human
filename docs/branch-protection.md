# 分支保护建议（Branch Protection）

> 目标：确保 `main` 分支不能在必需检查失败时合并，从而锁定全绿 CI。

## 建议设置（GitHub → Settings → Branches → branch protection rules → `main`）

1. **Require a pull request before merging**
   - `Require approvals`：1（或个人项目 0，取决于协作规模）
   - 禁止直接 push 到 `main`（`Limit who can push matching branches` 仅 admin/maintainer）。

2. **Require status checks to pass before merging**
   将以下必需检查设为强制的（`Require branches to be up to date before merging` 勾选）：
   - `Dependency vulnerabilities`（security job）
   - `Python sidecar`（sidecar job：ruff / mypy / pytest / coverage / build / mock smoke）
   - `Flaky test detection`（flaky-detect job）
   - `Frontend (TS / vitest)`（tsc / eslint / vitest / build）
   - `Rust shell`（fmt / clippy -D warnings / test）
   - `Release gate`（release-gate job）

3. **Require conversation resolution before merging**（GitHub 默认）
   - 未解决的 review 对话必须 resolve 后才能合并。

4. **Dependabot alerts**：启用 security alerts，`Require review from Code Owners`（如配置）。

5. **Do not allow bypassing the above settings**：不勾选，避免 admin 绕过。

## 说明

- 由于 `release-gate` 通过 `needs: [sidecar, flaky-detect, frontend, rust, security]` 依赖所有前置 job，只要任一强制检查失败，`release-gate` 会因 `if: !failure()` 被跳过（结论为 skipped），从而阻止合并。
- 分支保护由仓库 owner 在 GitHub 界面配置（需 `admin` 权限），此处仅提供建议与勾选清单。