#!/usr/bin/env bash
#
# release-common.sh
#
# Shared judgment helpers for the macOS release-closure scripts
# (sign-notarize.sh, release-closure.sh, test_release_closure.sh).
#
# This file is intended to be *sourced*, not executed. Sourcing it defines the
# functions below and causes no side effects, so the test harness can exercise
# the exact same judgment logic the release scripts use.
#
# Every judgment is deliberately binary and honest:
#   - PASS       = verified pass on this machine
#   - FAIL       = verifiable on this machine but the check failed
#   - UNVERIFIED = cannot be verified without credentials / a clean Mac / a
#                  real install environment
#
# We never fabricate a PASS. Missing credentials or environment always map to
# UNVERIFIED with the exact resources required spelled out.

# ---------------------------------------------------------------------------
# Identity resolution
# ---------------------------------------------------------------------------

# Resolve the Developer ID Application signing identity.
# Prefers CODE_SIGN_IDENTITY; otherwise returns the first "Developer ID
# Application" identity reported by `security find-identity -p codesigning -v`.
# Echoes the identity (possibly empty). Returns 0 if an identity was found,
# 1 otherwise.
release_resolve_identity() {
  local id="${CODE_SIGN_IDENTITY:-}"
  if [[ -n "${id}" ]]; then
    printf '%s' "${id}"
    return 0
  fi
  id="$(
    security find-identity -p codesigning -v 2>/dev/null |
      awk '/Developer ID Application/{print $2; exit}'
  )"
  if [[ -n "${id}" ]]; then
    printf '%s' "${id}"
    return 0
  fi
  return 1
}

# Echo the number of valid codesigning identities (for reporting).
release_valid_identity_count() {
  security find-identity -p codesigning -v 2>/dev/null |
    awk '/valid identities found/{print $1}'
}

# ---------------------------------------------------------------------------
# Binary / signature checks
# ---------------------------------------------------------------------------

# Returns 0 if the file is a universal binary (arm64 + x86_64). Echoes the
# arch string for reporting. Returns 1 otherwise.
release_binary_universal() {
  local path="$1"
  if [[ ! -f "${path}" ]]; then
    printf 'missing'
    return 1
  fi
  local archs
  archs="$(lipo -archs "${path}" 2>/dev/null || true)"
  if [[ "${archs}" == *"arm64"* && "${archs}" == *"x86_64"* ]]; then
    printf '%s' "${archs}"
    return 0
  fi
  printf '%s' "${archs:-unknown}"
  return 1
}

# Returns 0 if the app bundle carries a valid (non-ad-hoc) signature that
# verifies deeply. Echoes the signature summary line for reporting.
# Accepts an optional --strict flag to additionally require spctl acceptance.
release_app_signature() {
  local strict=0
  local path="$1"
  shift
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --strict) strict=1 ;;
    esac
    shift
  done

  if [[ ! -d "${path}" ]]; then
    printf 'missing'
    return 1
  fi

  local sig
  sig="$(codesign -dv "${path}" 2>&1 | awk -F= '/^Signature=/{print $2}')"
  local team
  team="$(codesign -dv "${path}" 2>&1 | awk -F= '/^TeamIdentifier=/{print $2}')"
  printf 'Signature=%s TeamIdentifier=%s' "${sig:-unknown}" "${team:-not set}"

  # ad-hoc signatures are not release-acceptable.
  if [[ "${sig}" == "adhoc" ]]; then
    return 1
  fi

  if ! codesign --verify --deep --strict "${path}" >/dev/null 2>&1; then
    return 1
  fi

  if [[ "${strict}" -eq 1 ]]; then
    spctl --assess --type execute "${path}" >/dev/null 2>&1 || return 1
  fi
  return 0
}

# Returns 0 if Gatekeeper accepts the app (spctl --assess --type execute).
release_spctl_accepts() {
  local path="$1"
  spctl --assess --type execute "${path}" >/dev/null 2>&1
}

# ---------------------------------------------------------------------------
# Notarization credential presence
# ---------------------------------------------------------------------------

# Returns 0 if all four notarization credentials are present in the env.
release_has_notary_creds() {
  [[ -n "${APPLE_TEAM_ID:-}" &&
     -n "${APPLE_NOTARY_API_KEY:-}" &&
     -n "${APPLE_NOTARY_KEY_ID:-}" &&
     -n "${APPLE_NOTARY_ISSUER:-}" ]]
}

# ---------------------------------------------------------------------------
# Reporting / exit-code classification
# ---------------------------------------------------------------------------

# Print a single gate line with a PASS / FAIL / UNVERIFIED prefix.
#   release_gate <status> <label>
# status is one of: pass | fail | unverified
release_gate() {
  local status="$1"
  local label="$2"
  case "${status}" in
    pass) printf 'PASS        %s\n' "${label}" ;;
    fail) printf 'FAIL        %s\n' "${label}" ;;
    unverified) printf 'UNVERIFIED  %s\n' "${label}" ;;
    *) printf 'UNKNOWN     %s\n' "${label}" ;;
  esac
}

# Summarize a run and select the process exit code.
#   release_summary <failures> <unverified>
# Returns: 0 if no failures (UNVERIFIED is allowed but reported separately),
# 1 if at least one FAIL happened.
release_summary() {
  local failures="$1"
  local unverified="$2"
  if [[ "${failures}" -gt 0 ]]; then
    printf 'Release closure FAILED with %d FAIL and %d UNVERIFIED item(s).\n' \
      "${failures}" "${unverified}"
    return 1
  fi
  if [[ "${unverified}" -gt 0 ]]; then
    printf 'Release closure has 0 FAIL and %d UNVERIFIED item(s); see runbook for credentials/clean Mac.\n' \
      "${unverified}"
    return 0
  fi
  printf 'Release closure PASSED (all gates verified on this machine).\n'
  return 0
}