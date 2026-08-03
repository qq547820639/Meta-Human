# Signed and Notarized DMG Distribution Plan

**Goal:** Produce a signed, notarized, stapled macOS DMG that users can install without
Python, uv, or terminal commands, while keeping the sidecar self-contained.

**Scope guard:** Signing requires a paid Developer ID account, certificates, and
notarization credentials. This plan defines the release pipeline and verification
gates; execution waits for those credentials.

## Task 1: Release Certificate Requirements

**Files:**

- Create: `docs/release-checklists.md`

**Step 1:** Write a checklist for Developer ID Application certificate, Developer ID
Installer certificate, notarization API key, and team identifier.

**Step 2:** Verify each prerequisite manually and record evidence paths.

## Task 2: Universal Binary Build

**Files:**

- Modify: `scripts/build-sidecar.sh`
- Modify: `apps/desktop/src-tauri/tauri.conf.json`
- Create: `scripts/build-universal.sh`

**Step 1:** Add a failing release verification script that fails when the sidecar or
desktop binary is not universal (`lipo -archs` must contain `arm64` and `x86_64`).

**Step 2:** Implement universal compilation for Rust, React, and the Python sidecar.

**Step 3:** Confirm the release artifact passes `lipo` and all automated gates.

## Task 3: Tauri Release Build

**Files:**

- Create: `scripts/release-dmg.sh`
- Modify: `apps/desktop/src-tauri/tauri.conf.json`

**Step 1:** Write a release script that runs all tests, builds the sidecar, builds the
desktop bundle, and fails on any warning.

**Step 2:** Configure bundle identity, category, minimum system version, and icon.

**Step 3:** Confirm `pnpm --dir apps/desktop tauri build` produces a DMG.

## Task 4: Signing

**Files:**

- Modify: `scripts/release-dmg.sh`

**Step 1:** Add codesigning steps for the sidecar, framework, app bundle, and DMG.

**Step 2:** Verify with `codesign --verify --deep --strict` and `spctl --assess`.

## Task 5: Notarization and Staple

**Files:**

- Modify: `scripts/release-dmg.sh`

**Step 1:** Add `xcrun notarytool submit`, polling, and `xcrun stapler staple`.

**Step 2:** Add a verification script that fails unless notarization is approved and
the DMG is stapled.

## Task 6: Fresh-Install Smoke

**Step 1:** Install the DMG into a clean user account or disposable VM.

**Step 2:** Verify:

- Gatekeeper allows opening with no terminal workaround;
- the app opens directly to `准备工作室`;
- sidecar starts without Python or uv;
- quitting removes the child process;
- paths containing spaces and Chinese characters work.

## Task 7: Release Gate

Run:

```bash
scripts/verify-foundation.sh
scripts/release-dmg.sh
codesign --verify --deep --strict "dist/VoxStudio.app"
spctl --assess --type execute "dist/VoxStudio.app"
xcrun stapler validate "dist/VoxStudio.dmg"
```

**Done when:** a signed, notarized, stapled DMG passes every verification and installs
cleanly on a fresh Mac.

## Current verification status

The following has already been verified on the current host:

- `pnpm --dir apps/desktop tauri build` produces an ad-hoc signed DMG.
- `hdiutil verify` reports a valid checksum.
- The packaged app launches the sidecar from `Contents/MacOS`.
- Graceful quit terminates the full sidecar process group.
- The mock Provider end-to-end readiness smoke reaches `ready`.
- `scripts/build-universal.sh` builds and verifies universal sidecar and desktop
  binaries (`lipo -archs` reports `arm64 x86_64`).
- The universal DMG checksum is valid and the mock readiness smoke passes on both
  the arm64 and x86_64 sidecar binaries.
- The signing integration was verified with ad-hoc identity `-`:
  `codesign --verify --deep --strict` passes on the app bundle and Tauri signs
  the sidecar, desktop binary, app, and DMG during the bundle step.
- `scripts/smoke-dmg.sh` mounts the universal DMG, starts the packaged app and
  sidecar, verifies graceful quit cleanup, and passes on this host.
- `NSCameraUsageDescription` and `NSMicrophoneUsageDescription` are merged into
  the app bundle and verified in the final DMG.

Still required before a signed release:

- Developer ID signing identity (currently `0 valid identities found`).
- `APPLE_TEAM_ID`, `APPLE_NOTARY_API_KEY`, `APPLE_NOTARY_KEY_ID`,
  `APPLE_NOTARY_ISSUER`.

After providing credentials, run:

```bash
scripts/record-release-readiness.sh
scripts/record-provider-readiness.sh
scripts/release-dmg.sh
```
