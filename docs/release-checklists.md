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
