# Release Checklist

Run this checklist before creating a signed DMG. Every item must have evidence
recorded; a missing item blocks release.

## Prerequisites

- [ ] Apple Developer account with Developer ID Application certificate.
- [ ] Developer ID Installer certificate when creating an installer package.
- [ ] Notarization API key, key ID, and issuer ID.
- [ ] `APPLE_TEAM_ID` available in the release environment.
- [ ] App icon and bundle metadata approved.
- [ ] Release notes and version number approved.

## Build Gates

- [ ] `scripts/verify-foundation.sh` passes.
- [ ] `scripts/build-sidecar.sh` produces a self-contained sidecar.
- [ ] `scripts/build-universal.sh` reports both `arm64` and `x86_64`.
- [ ] `pnpm --dir apps/desktop tauri build` produces a DMG.

## Signing

- [ ] `codesign --verify --deep --strict` passes on the app bundle.
- [ ] `spctl --assess --type execute` passes on the app bundle.
- [ ] Every nested binary is signed, including the sidecar.
- [ ] `scripts/release-dmg.sh` signs through Tauri with the resolved Developer ID
      identity, verifies the app bundle, and then notarizes and staples the DMG.
- [ ] `Info.plist` contains camera and microphone usage descriptions.

## Notarization

- [ ] `xcrun notarytool submit` returns `Accepted`.
- [ ] `xcrun stapler staple` succeeds.
- [ ] `xcrun stapler validate` succeeds on the DMG.

## Fresh Install Smoke

- [ ] `scripts/smoke-dmg.sh` passes locally.
- [ ] DMG installs on a clean Mac without terminal workarounds.
- [ ] App opens directly to `准备工作室`.
- [ ] Sidecar starts without Python or uv.
- [ ] Quitting the app terminates the sidecar.
- [ ] Paths containing spaces and Chinese characters work.

## Current Environment Evidence

Recorded during the last automated audit. Re-run these commands after providing the
missing resources:

```bash
security find-identity -p codesigning -v
# expected: at least 1 valid identity; current: 0 valid identities found

lipo -archs apps/desktop/src-tauri/binaries/digital-human-sidecar-universal-apple-darwin
lipo -archs apps/desktop/src-tauri/target/universal-apple-darwin/release/voxstudio-desktop
# expected: arm64 x86_64; current: arm64 x86_64

env | grep '^APPLE_'
# expected: APPLE_TEAM_ID, APPLE_NOTARY_API_KEY, APPLE_NOTARY_KEY_ID, APPLE_NOTARY_ISSUER
```

## 签名 / 公证 / 安装闭环（可执行）

这是在正式发布前逐项执行的「正式发布闭环」可执行清单。每一项都对应一个可运行脚本或
明确的 runbook。**缺凭证 / 无干净 Mac 的项一律标 UNVERIFIED，不得声称通过。**

### 1. 就绪审计（本机可自动化）

```bash
scripts/verify-release-readiness.sh      # 双架构二进制 + 凭证 + 身份 + 工具
scripts/smoke-dmg.sh                     # DMG 校验 / 双架构 / 签名校验 / 启动/退出清理
scripts/test_release_closure.sh          # 发布闭环判定逻辑的轻量回归测试
```

- [ ] 双架构 sidecar 与 desktop 均为 arm64 + x86_64。
- [ ] DMG 可挂载、校验合法，app + sidecar 可启动并在退出时清理。
- [ ] 发布闭环测试脚本全部通过。

### 2. 签名 / 公证 / stapling（需 Developer ID + 公证凭证）

```bash
scripts/sign-notarize.sh                 # 身份检测 -> codesign -> codesign 校验 -> spctl -> notarytool -> staple -> validate
```

- [ ] `security find-identity -p codesigning -v` 至少 1 个有效
      `Developer ID Application` 身份（无则脚本标 UNVERIFIED 并给出取证步骤）。
- [ ] `codesign --force --deep --timestamp --options runtime --sign "<identity>"` 成功。
- [ ] `codesign --verify --deep --strict` 通过，且 `Signature` 非 `adhoc`。
- [ ] `spctl --assess --type execute` 接受（非 rejected）。
- [ ] `xcrun notarytool submit ... --wait` 返回 `Accepted`。
- [ ] `xcrun stapler staple` 与 `xcrun stapler validate` 成功。

**缺凭证时脚本行为：** 无身份 / 无 `APPLE_TEAM_ID`、`APPLE_NOTARY_API_KEY`、
`APPLE_NOTARY_KEY_ID`、`APPLE_NOTARY_ISSUER` 时，输出 UNVERIFIED 并以退出码 2 结束，
绝不伪造通过。

### 3. 发布闭环验收（本机 + 目标机）

```bash
scripts/release-closure.sh                          # 双架构 / 签名 / spctl / staple / 权限 / 离线
scripts/release-closure.sh --offline                # 尝试真实断网启动（需免密 sudo 切换网络）
scripts/release-closure.sh --install-root <已安装App> # 校验已安装实例的覆盖/卸载/崩溃清理
```

- [ ] 双架构二进制存在（sidecar / desktop / app 内两个二进制）。
- [ ] app 非 ad-hoc 签名且 `spctl` 接受。
- [ ] DMG 已 staple（`stapler validate`）。
- [ ] 断网启动：断网后 app + sidecar 正常启动、无 provider 调用挂起。
- [ ] 首次权限：干净 Mac 上首次启动触发相机 / 麦克风 TCC 授权，可授予并保存到钥匙串。
- [ ] 覆盖升级：保留数据目录覆盖安装新版，数据库迁移生成 `.bak.<版本>`，会话/设置保留。
- [ ] 卸载清理：删除 app 与数据目录后无残留进程/文件。
- [ ] 崩溃清理：kill 主程序后无残留进程，重启可恢复，临时资源(像/录音)释放。

### 3.5 产物溯源（Provenance）

```bash
bash -n scripts/release-provenance.sh          # 语法自检
scripts/release-provenance.sh --output-dir output   # 对已构建产物生成校验和
SIGNED=1 NOTARIZED=1 scripts/release-provenance.sh  # 已签名+公证的发布
```

- [ ] `output/SHA256SUMS` 逐行给出每个产物的 sha256 与绝对路径；缺失产物标注 `MISSING`。
- [ ] `output/provenance.json` 含 `version` / `commit_sha` / `build_time_utc` /
      `sign_status`，且 `sign_status` 与真实签名/公证状态一致（无凭证时记
      `undetermined` / `unsigned`，绝不声称已签名）。
- [ ] `scripts/release-dmg.sh` 在签名 + 公证 + stapling 完成后自动生成溯源。

### 3.6 release-gate 与 UNVERIFIED 发布门禁

`release-gate` job 在 `sidecar`/`frontend`/`rust`/`security` 全部通过后：构建 universal
产物 → 生成溯源 → 上传 `release-artifacts`。**发布到真实端点的步骤被 `SIGNING_CERT` 与
`SIGNING_IDENTITY` 两个 secret 门禁**；缺失时输出 `UNVERIFIED` 标记且不发布。

- [ ] CI 中 `release-gate` 构建产物并生成 `SHA256SUMS` / `provenance.json`。
- [ ] 未配置 `SIGNING_CERT` / `SIGNING_IDENTITY` 时打印 `UNVERIFIED` 标记，且不触碰任何
      真实发布端点。

### 4. 钉死项（当前环境）

在补齐凭证 / 干净 Mac 前，以下保持 UNVERIFIED 并作为发布阻塞项：

| 项 | 缺什么 | 当前状态 |
| --- | --- | --- |
| Developer ID 签名 | Developer ID Application 证书（有效 codesigning 身份） | 本机 0 个有效身份，UNVERIFIED |
| notarization / stapling | `APPLE_TEAM_ID` + 三个 notary 凭证 | 未配置，UNVERIFIED |
| 干净安装 + 首次权限 | 干净 Mac + 真实 TCC 交互 | 无干净 Mac，UNVERIFIED |
| 断网启动 / 覆盖升级 / 卸载 / 崩溃清 | 真实安装环境 / 免密 sudo | 未执行，UNVERIFIED |
