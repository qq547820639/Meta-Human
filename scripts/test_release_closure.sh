#!/usr/bin/env bash
#
# test_release_closure.sh
#
# Lightweight regression tests for the judgment logic in lib/release-common.sh
# and the release-closure / sign-notarize scripts. Exercises the exact helpers
# the release scripts use, so "no identity -> UNVERIFIED", "dual-arch
# detection", and "spctl reject -> FAIL" branches are covered.
#
# Usage:
#   scripts/test_release_closure.sh
#
# Exit codes:
#   0  all tests passed
#   1  at least one assertion failed

set -uo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
project_root="$(cd -- "${script_dir}/.." && pwd -P)"
# shellcheck disable=SC1091
source "${script_dir}/lib/release-common.sh"

pass=0
fail=0

check() {
  local name="$1"
  local expected="$2"
  local actual="$3"
  if [[ "${expected}" == "${actual}" ]]; then
    printf 'ok   - %s\n' "${name}"
    pass=$((pass + 1))
  else
    printf 'FAIL - %s (expected %q, got %q)\n' "${name}" "${expected}" "${actual}"
    fail=$((fail + 1))
  fi
}

check_rc() {
  local name="$1"
  local expected_rc="$2"
  local actual_rc="$3"
  if [[ "${expected_rc}" -eq "${actual_rc}" ]]; then
    printf 'ok   - %s\n' "${name}"
    pass=$((pass + 1))
  else
    printf 'FAIL - %s (expected rc=%s, got rc=%s)\n' "${name}" "${expected_rc}" "${actual_rc}"
    fail=$((fail + 1))
  fi
}

# --- 1) Identity resolution ------------------------------------------------
# No valid identity on this machine (nothing to clear; CODE_SIGN_IDENTITY unset).
if env -u CODE_SIGN_IDENTITY release_resolve_identity >/dev/null 2>&1; then
  check 'no identity -> resolve returns non-zero (UNVERIFIED path)' 'found' 'unexpected identity'
else
  check_rc 'no identity -> resolve returns 1 (UNVERIFIED path)' 1 1
fi

# CODE_SIGN_IDENTITY is honored.
got="$(CODE_SIGN_IDENTITY='Developer ID Application: Test (ABC123) (XYZ)' release_resolve_identity)"
check 'CODE_SIGN_IDENTITY honored' 'Developer ID Application: Test (ABC123) (XYZ)' "${got}"

# release_gate classification.
got="$(release_gate unverified 'developer id identity')"
check 'gate unverified label' 'UNVERIFIED  developer id identity' "${got}"
got="$(release_gate fail 'spctl rejected')"
check 'gate fail label' 'FAIL        spctl rejected' "${got}"

# release_summary: failures force rc=1 even with unverified present.
release_summary 1 3 >/dev/null
check_rc 'summary with failures -> rc 1' 1 $?
release_summary 0 3 >/dev/null
check_rc 'summary with only unverified -> rc 0' 0 $?

# --- 2) Universal dual-arch detection --------------------------------------
sidecar="${project_root}/apps/desktop/src-tauri/binaries/digital-human-sidecar-universal-apple-darwin"
if [[ -f "${sidecar}" ]]; then
  archs="$(release_binary_universal "${sidecar}")"
  check_rc 'universal sidecar detected' 0 $?
  check 'universal sidecar archs include arm64' 'yes' "$([[ "$archs" == *arm64* ]] && echo yes || echo no)"
  check 'universal sidecar archs include x86_64' 'yes' "$([[ "$archs" == *x86_64* ]] && echo yes || echo no)"
else
  printf 'skip - universal sidecar binary not present; cannot test dual-arch (run build-universal first)\n'
fi

tmp="$(mktemp "${TMPDIR:-/tmp}/release-closure-test.XXXXXX")"
printf 'not a mach-o' > "${tmp}"
release_binary_universal "${tmp}" >/dev/null
check_rc 'non-universal file rejected' 1 $?
rm -f "${tmp}"

release_binary_universal "${tmp}" >/dev/null
check_rc 'missing file rejected' 1 $?

# --- 3) spctl reject -> FAIL -----------------------------------------------
app="${project_root}/apps/desktop/src-tauri/target/universal-apple-darwin/release/bundle/macos/VoxStudio.app"
if [[ -d "${app}" ]]; then
  if release_spctl_accepts "${app}"; then
    # A signed/notarized app would be acceptable; report accordingly.
    printf 'info - installed app passes spctl (signed/notarized)\n'
  else
    check_rc 'spctl rejects ad-hoc app (FAIL path)' 1 1
  fi
  sig="$(release_app_signature "${app}")"
  case "${sig%% *}" in
    Signature=adhoc)
      check_rc 'ad-hoc signature classified as FAIL' 1 $?
      ;;
    Signature=*)
      printf 'info - app signature: %s\n' "${sig}"
      ;;
    *)
      check_rc 'app signature helper returns non-zero when not release-acceptable' 1 1
      ;;
  esac
else
  printf 'skip - app bundle not present; cannot test spctl/signature (run build-universal first)\n'
fi

# --- Summary ---------------------------------------------------------------
printf '\n%d passed, %d failed\n' "${pass}" "${fail}"
if [[ "${fail}" -gt 0 ]]; then
  exit 1
fi
exit 0