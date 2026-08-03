#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
project_root="$(cd -- "${script_dir}/.." && pwd -P)"
desktop_project="${project_root}/apps/desktop"
binaries_dir="${project_root}/apps/desktop/src-tauri/binaries"
arm64_sidecar="${binaries_dir}/digital-human-sidecar-aarch64-apple-darwin"
x86_64_sidecar="${binaries_dir}/digital-human-sidecar-x86_64-apple-darwin"
sidecar_binary="${binaries_dir}/digital-human-sidecar-universal-apple-darwin"
desktop_binary="${project_root}/apps/desktop/src-tauri/target/universal-apple-darwin/release/voxstudio-desktop"
universal_desktop_binary="${desktop_binary}"
if [[ ! -f "${universal_desktop_binary}" ]]; then
  desktop_binary="${project_root}/apps/desktop/src-tauri/target/release/voxstudio-desktop"
else
  desktop_binary="${universal_desktop_binary}"
fi

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  cat <<'EOF'
Usage: scripts/build-universal.sh

Builds universal sidecar and desktop binaries, then verifies that both contain
arm64 and x86_64 slices. The x86_64 Sidecar build requires:

  VOXSTUDIO_X86_PYTHON=/path/to/x86_64/python3.12

Optionally set VOXSTUDIO_X86_TOOLCHAIN to a PATH prefix containing
x86-compatible macOS tool wrappers when building on an Apple Silicon host.
Set VOXSTUDIO_SIGNING_IDENTITY to a Developer ID Application identity to sign
the app and DMG during the Tauri bundle step.
Set VOXSTUDIO_SKIP_SIDECAR_BUILD=1 to reuse existing sidecar binaries during
iterative desktop-only rebuilds.
EOF
  exit 0
fi

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

if [[ -z "${VOXSTUDIO_SKIP_SIDECAR_BUILD:-}" ]]; then
  printf 'Building arm64 Sidecar...\n'
  "${script_dir}/build-sidecar.sh"
  printf 'Building x86_64 Sidecar...\n'
  "${script_dir}/build-sidecar-x86_64.sh"
fi

printf 'Creating universal Sidecar binary...\n'
lipo -create "${arm64_sidecar}" "${x86_64_sidecar}" -output "${sidecar_binary}"
chmod +x "${sidecar_binary}"

printf 'Building universal desktop bundle...\n'
pnpm --dir "${desktop_project}" tauri build --target universal-apple-darwin "${tauri_config_args[@]}"

failures=0

check_universal() {
  local label="$1"
  local path="$2"
  if [[ ! -f "${path}" ]]; then
    printf 'FAIL  %s missing: %s\n' "${label}" "${path}"
    failures=$((failures + 1))
    return 1
  fi
  local archs
  archs="$(lipo -archs "${path}" 2>/dev/null || true)"
  if [[ "${archs}" == *"arm64"* && "${archs}" == *"x86_64"* ]]; then
    printf 'PASS  %s universal: %s\n' "${label}" "${archs}"
  else
    printf 'FAIL  %s is not universal: %s\n' "${label}" "${archs:-unknown}"
    failures=$((failures + 1))
  fi
}

printf '%s\n' '-- Universal binary check --'
check_universal "sidecar" "${sidecar_binary}"
check_universal "desktop" "${desktop_binary}"

if [[ "${failures}" -eq 0 ]]; then
  printf '%s\n' 'Universal build verification PASSED.'
  exit 0
fi
printf '%s\n' 'Universal build verification FAILED.'
exit 1
