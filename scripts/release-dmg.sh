#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
project_root="$(cd -- "${script_dir}/.." && pwd -P)"
desktop_project="${project_root}/apps/desktop"

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  cat <<'EOF'
Usage: scripts/release-dmg.sh

Builds a signed and notarized DMG. Requires Apple release credentials:

  APPLE_TEAM_ID
  APPLE_NOTARY_API_KEY
  APPLE_NOTARY_KEY_ID
  APPLE_NOTARY_ISSUER

The signing identity is read from CODE_SIGN_IDENTITY, or the first valid
Developer ID Application identity installed on the machine.

The script fails before building when required credentials are absent.
EOF
  exit 0
fi

if [[ -z "${APPLE_TEAM_ID:-}" ]]; then
  printf 'error: APPLE_TEAM_ID is required\n' >&2
  exit 2
fi
if [[ -z "${APPLE_NOTARY_API_KEY:-}" || -z "${APPLE_NOTARY_KEY_ID:-}" || -z "${APPLE_NOTARY_ISSUER:-}" ]]; then
  printf 'error: notarization credentials are required\n' >&2
  exit 2
fi

signing_identity="${CODE_SIGN_IDENTITY:-}"
if [[ -z "${signing_identity}" ]]; then
  signing_identity="$(
    security find-identity -p codesigning -v 2>/dev/null |
      awk '/^[[:space:]]*[0-9]+\)/{print $2; exit}'
  )"
fi
if [[ -z "${signing_identity}" ]]; then
  printf 'error: no Developer ID signing identity is available\n' >&2
  printf '      set CODE_SIGN_IDENTITY or install a valid Developer ID Application certificate\n' >&2
  exit 2
fi

printf '%s\n' '-- Release gates --'
scripts/verify-foundation.sh

printf '%s\n' '-- Universal desktop release build --'
VOXSTUDIO_SIGNING_IDENTITY="${signing_identity}" scripts/build-universal.sh

printf '%s\n' '-- Signing and notarization --'
dmg="$(find "${desktop_project}/src-tauri/target/universal-apple-darwin/release/bundle/dmg" -maxdepth 1 -name '*.dmg' -print -quit)"
if [[ -z "${dmg}" ]]; then
  printf 'error: DMG was not produced\n' >&2
  exit 1
fi

app="${desktop_project}/src-tauri/target/universal-apple-darwin/release/bundle/macos/VoxStudio.app"
codesign --verify --deep --strict "${app}"
spctl --assess --type execute "${app}"

xcrun notarytool submit "${dmg}" \
  --key "${APPLE_NOTARY_API_KEY}" \
  --key-id "${APPLE_NOTARY_KEY_ID}" \
  --issuer "${APPLE_NOTARY_ISSUER}" \
  --wait
xcrun stapler staple "${dmg}"
xcrun stapler validate "${dmg}"

printf 'Signed and notarized DMG: %s\n' "${dmg}"
