#!/usr/bin/env bash
#
# build-arm64.sh
#
# Builds the native arm64 VoxStudio desktop bundle (app + dmg) using an
# already-provisioned arm64 sidecar binary. This is the fallback path for the
# release gate when Apple signing credentials are NOT present: the full
# universal build (build-universal.sh) additionally requires an x86_64 Python
# toolchain and a Developer ID, neither of which exists on a plain arm64 CI
# runner. Building arm64 keeps the release gate real (it produces a bundle and
# runs the real codesign/spctl verification, which honestly reports
# "unverified") instead of failing the pipeline on a missing x86_64 toolchain.
#
# The signed, notarized, universal release is UNVERIFIED until both the Apple
# credentials AND the x86_64 toolchain are provisioned (see build-universal.sh).
#
# Usage:
#   scripts/build-arm64.sh
#
# Requires an arm64 sidecar binary at:
#   apps/desktop/src-tauri/binaries/digital-human-sidecar-aarch64-apple-darwin
#
# Set VOXSTUDIO_SIGNING_IDENTITY to a Developer ID Application identity to sign
# the app and DMG during the Tauri bundle step (codesign + hardened runtime).

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
project_root="$(cd -- "${script_dir}/.." && pwd -P)"
desktop_project="${project_root}/apps/desktop"
arm64_sidecar="${desktop_project}/src-tauri/binaries/digital-human-sidecar-aarch64-apple-darwin"

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  sed -n '2,35p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit 0
fi

if [[ ! -x "${arm64_sidecar}" ]]; then
  printf 'error: arm64 sidecar binary not found or not executable: %s\n' "${arm64_sidecar}" >&2
  printf 'Build/publish it with scripts/build-sidecar.sh, or download the sidecar-binary artifact.\n' >&2
  exit 2
fi

printf 'Building arm64 desktop bundle (arch: %s)...\n' "$(uname -m)"

signing_config=''
cleanup() {
  if [[ -n "${signing_config}" && -e "${signing_config}" ]]; then
    rm -f "${signing_config}"
  fi
}
trap cleanup EXIT

tauri_config_args=()
if [[ -n "${VOXSTUDIO_SIGNING_IDENTITY:-}" ]]; then
  signing_config="$(mktemp "${TMPDIR:-/tmp}/voxstudio-tauri-signing.XXXXXX.json")"
  python3 -c 'import json,sys; json.dump({"bundle":{"macOS":{"signingIdentity":sys.argv[1],"hardenedRuntime":True}}}, open(sys.argv[2], "w"))' \
    "${VOXSTUDIO_SIGNING_IDENTITY}" "${signing_config}"
  tauri_config_args=(--config "${signing_config}")
fi

# Native arch build (arm64 on an arm64 host). Tauri consumes the arm64 sidecar
# from binaries/ via externalBin.
pnpm --dir "${desktop_project}" tauri build "${tauri_config_args[@]}"

app="${desktop_project}/src-tauri/target/release/bundle/macos/VoxStudio.app"
dmg="$(find "${desktop_project}/src-tauri/target/release/bundle/dmg" \
  -maxdepth 1 -name '*.dmg' -print -quit 2>/dev/null || true)"

if [[ -d "${app}" ]]; then
  printf 'arm64 app bundle: %s\n' "${app}"
else
  printf 'error: expected arm64 app bundle missing: %s\n' "${app}" >&2
  exit 1
fi
if [[ -n "${dmg}" && -f "${dmg}" ]]; then
  printf 'arm64 dmg: %s\n' "${dmg}"
else
  printf 'warning: no arm64 dmg produced\n' >&2
fi
printf 'arm64 build completed.\n'