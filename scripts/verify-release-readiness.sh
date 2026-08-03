#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
project_root="$(cd -- "${script_dir}/.." && pwd -P)"
binaries_dir="${project_root}/apps/desktop/src-tauri/binaries"
sidecar_binary="${binaries_dir}/digital-human-sidecar-universal-apple-darwin"
desktop_binary="${project_root}/apps/desktop/src-tauri/target/release/voxstudio-desktop"
universal_desktop_binary="${project_root}/apps/desktop/src-tauri/target/universal-apple-darwin/release/voxstudio-desktop"
if [[ -f "${universal_desktop_binary}" ]]; then
  desktop_binary="${universal_desktop_binary}"
fi

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  cat <<'EOF'
Usage: scripts/verify-release-readiness.sh

Checks every release prerequisite:
  - packaged sidecar exists
  - sidecar and desktop binaries are universal
  - Apple release credentials are set
  - notarization tools are available

Exit code 0 only when all prerequisites are present.
EOF
  exit 0
fi

failures=0

report() {
  local status="$1"
  local label="$2"
  if [[ "${status}" -eq 0 ]]; then
    printf 'PASS  %s\n' "${label}"
  else
    printf 'FAIL  %s\n' "${label}"
    failures=$((failures + 1))
  fi
}

check_sidecar() {
  if [[ -x "${sidecar_binary}" ]]; then
    report 0 "packaged sidecar exists"
  else
    report 1 "packaged sidecar exists"
  fi
}

check_universal() {
  local label="$1"
  local path="$2"
  if [[ ! -f "${path}" ]]; then
    report 1 "${label} is universal"
    return 0
  fi
  local archs
  archs="$(lipo -archs "${path}" 2>/dev/null || true)"
  if [[ "${archs}" == *"arm64"* && "${archs}" == *"x86_64"* ]]; then
    report 0 "${label} is universal"
  else
    report 1 "${label} is universal"
  fi
}

check_credentials() {
  if [[ -n "${APPLE_TEAM_ID:-}" &&
        -n "${APPLE_NOTARY_API_KEY:-}" &&
        -n "${APPLE_NOTARY_KEY_ID:-}" &&
        -n "${APPLE_NOTARY_ISSUER:-}" ]]; then
    report 0 "Apple release credentials are set"
  else
    report 1 "Apple release credentials are set"
  fi
}

check_identity() {
  local count
  count="$(security find-identity -p codesigning -v 2>/dev/null |
    awk '/valid identities found/{print $1}')"
  if [[ -n "${count}" && "${count}" -gt 0 ]]; then
    report 0 "Developer ID signing identity is available"
  else
    report 1 "Developer ID signing identity is available"
  fi
}

check_tools() {
  if command -v codesign >/dev/null 2>&1 &&
    command -v xcrun >/dev/null 2>&1 &&
    command -v lipo >/dev/null 2>&1; then
    report 0 "signing and notarization tools are available"
  else
    report 1 "signing and notarization tools are available"
  fi
}

printf '%s\n' '-- Release readiness --'
check_sidecar
check_universal "sidecar" "${sidecar_binary}"
check_universal "desktop" "${desktop_binary}"
check_credentials
check_identity
check_tools

if [[ "${failures}" -eq 0 ]]; then
  printf '%s\n' 'Release readiness PASSED.'
  exit 0
fi
printf 'Release readiness FAILED with %d problem(s).\n' "${failures}"
exit 1
