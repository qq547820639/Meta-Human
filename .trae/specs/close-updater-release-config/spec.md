# Close the REAL Updater + Release Configuration Loop — Spec

## Why
The Tauri v2 updater was wired end-to-end but still carried **placeholder** production
config (pubkey/endpoints) and the CI release gate only *echoed* a message instead of
actually running real verification. Signed/notarized states were inferred from
credential presence rather than from real tool output. This leaves the app unable to
ship a trustworthy, verifiable release and risks a false sense of security.

## What Changes
- **Remove placeholder production config in `tauri.conf.json`** and replace it with a
  fails-closed strategy: a clearly-marked development placeholder pubkey + empty
  `endpoints[]`, with documentation that production values are injected at build time
  via `VOXSTUDIO_UPDATE_PUBKEY` / `VOXSTUDIO_UPDATE_ENDPOINT_STABLE` /
  `VOXSTUDIO_UPDATE_ENDPOINT`. Without the real pubkey/endpoints the app reports
  updates as "not configured" and never attempts an unsigned/fake update.
- **Make signed/notarized states come from REAL tool verification**, not from
  credential presence. New `scripts/verify-release.sh` runs `codesign --verify --deep
  --strict`, `spctl --assess --type execute`, and (only when notary credentials are
  present) `xcrun notarytool submit --wait` + `xcrun stapler staple/validate`, and emits
  an honest `output/verify.json` with `status` ∈ `notarized | signed | unsigned |
  unverified`.
- **Make CI actually run the release gate.** `ci.yml` `release-gate` now runs
  `verify-release.sh` + `release-provenance.sh`; when signing credentials ARE present it
  fails the gate on any real verification failure, and otherwise emits an explicit
  UNVERIFIED marker (never claims a release).
- **Make provenance honest.** `scripts/release-provenance.sh` derives `sign_status` only
  from the real `verify.json`, never from env presence.
- **Add focused tests**: Rust unit tests for update manifest parsing, Ed25519 signature
  verification (accept/reject/tamper/malformed), and error mapping; Python tests for
  migration backup/restore/rollback.
- **Update `docs/release-checklists.md` and `CHANGELOG.md`** to document the new
  verify/provenance/gate workflow and the fails-closed injection strategy.

## Impact
- Affected specs: `wire-tauri-updater`, `release-closure-natural-conversation`
- Affected code: `apps/desktop/src-tauri/tauri.conf.json`, `apps/desktop/src-tauri/src/updater.rs`,
  `apps/desktop/src-tauri/Cargo.toml`, `.github/workflows/ci.yml`, `scripts/verify-release.sh`,
  `scripts/release-provenance.sh`, `scripts/release-dmg.sh`, `docs/release-checklists.md`,
  `CHANGELOG.md`, `apps/sidecar/tests/unit/persistence/test_database_backup.py`

## ADDED Requirements

### Requirement: Fails-Closed updater configuration
The system SHALL not ship a real production updater pubkey/endpoint in the committed
config. Production values SHALL be injected at build time via documented env vars; when
absent, the app SHALL report updates as "not configured" and refuse to install.

#### Scenario: Production values absent
- **WHEN** the app is built without `VOXSTUDIO_UPDATE_PUBKEY` / `VOXSTUDIO_UPDATE_ENDPOINT*`
- **THEN** `get_update_config()` reports `configured=false` and updates are not offered.

#### Scenario: Production values injected
- **WHEN** the build injects a real pubkey + endpoint
- **THEN** `get_update_config()` reports `configured=true` and the real endpoint is used.

### Requirement: Sign/notarize status from REAL tool verification
The system SHALL derive signed/notarized status only from `codesign --verify --deep
--strict`, `spctl --assess --type execute`, and (with credentials) `notarytool`/`stapler`
output, never from credential/env presence alone.

#### Scenario: Validly signed and notarized
- **WHEN** the app passes codesign + spctl and the DMG passes notarytool + stapler
- **THEN** `verify.json` records `status=notarized` and the gate reports PASSED.

#### Scenario: No credentials / no real verification ran
- **WHEN** no cert/notary credentials are present and no real tool ran
- **THEN** `verify.json` records `status=unverified` and the gate emits an UNVERIFIED
  marker without claiming a release.

### Requirement: CI release gate runs real verification
The CI `release-gate` job SHALL run `verify-release.sh` and `release-provenance.sh` and,
when signing credentials are present, SHALL fail the pipeline on any real verification
failure.

#### Scenario: Credentials present but verification fails
- **WHEN** `SIGNING_CERT`/`SIGNING_IDENTITY` are set and `verify.json` status is neither
  `notarized` nor `signed`
- **THEN** the gate exits non-zero with `RELEASE GATE FAILED` and the pipeline fails.

### Requirement: Update manifest parsing & signature verification
`updater.rs` SHALL parse Tauri v2 manifests and verify Ed25519 signatures, rejecting any
malformed/bad signature such that a tampered update is never installed.

#### Scenario: Signature valid
- **WHEN** a payload is signed with the matching key
- **THEN** `verify_update_signature` returns `true`.

#### Scenario: Signature tampered / wrong key / malformed
- **WHEN** the payload is modified, signed by a different key, or the key/signature are
  malformed
- **THEN** `verify_update_signature` returns `false` and the update is never installed.

### Requirement: Migration backup/restore/rollback
The sidecar SHALL back up the database before applying pending migrations and leave a
restoreable `.bak` on failure so pre-upgrade data survives a failed upgrade.

#### Scenario: Migration fails
- **WHEN** a migration fails mid-upgrade
- **THEN** a `.bak.<version>` restore point holds pre-upgrade data, the failed migration
  is not recorded as applied, and the DB can be restored.

## MODIFIED Requirements
None removed; requirements are additive to the existing updater/release work in
`wire-tauri-updater` and `release-closure-natural-conversation`.

## REMOVED Requirements
_N/A_