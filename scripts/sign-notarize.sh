#!/usr/bin/env bash
#
# sign-notarize.sh
#
# Developer ID Application signing + notarization + stapling for the VoxStudio
# universal app bundle and DMG.
#
# Principles:
#   - Every step records its real output.
#   - Missing identity or notarization credentials are reported as UNVERIFIED
#     with the exact resources required, and the script exits non-zero.
#   - We never fabricate a PASS; ad-hoc signatures are treated as FAIL.
#
# Usage:
#   scripts/sign-notarize.sh [--app PATH] [--dmg PATH] [--identity ID] [--no-sign]
#
# Options:
#   --app PATH     App bundle to sign (default: universal Tauri build output).
#   --dmg PATH     DMG to sign + notarize + staple (default: output/VoxStudio-universal.dmg).
#   --identity ID  Override the signing identity (else CODE_SIGN_IDENTITY, else
#                  first valid "Developer ID Application" identity).
#   --no-sign      Skip the codesign step (e.g. to only re-run notarization).
#
# Required env for notarization:
#   APPLE_TEAM_ID, APPLE_NOTARY_API_KEY, APPLE_NOTARY_KEY_ID, APPLE_NOTARY_ISSUER
#
# Exit codes:
#   0  all executed gates passed
#   1  a verifiable gate failed (e.g. spctl rejects, codesign fails)
#   2  required identity or credentials are missing (UNVERIFIED)
#   3  usage error

set -uo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
project_root="$(cd -- "${script_dir}/.." && pwd -P)"
# shellcheck disable=SC1091
source "${script_dir}/lib/release-common.sh"

output_dir="${project_root}/output"
log_md="${output_dir}/release-sign-notarize.md"
body_file="$(mktemp "${TMPDIR:-/tmp}/sign-notarize.XXXXXX")"

app="${project_root}/apps/desktop/src-tauri/target/universal-apple-darwin/release/bundle/macos/VoxStudio.app"
dmg="${project_root}/output/VoxStudio-universal.dmg"
identity_override=''
do_sign=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app) app="$2"; shift 2 ;;
    --dmg) dmg="$2"; shift 2 ;;
    --identity) identity_override="$2"; shift 2 ;;
    --no-sign) do_sign=0; shift ;;
    --help|-h)
      sed -n '2,40p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) printf 'error: unknown option: %s\n' "$1" >&2; exit 3 ;;
  esac
done

log() { printf '%s\n' "$*" | tee -a "${body_file}"; }

failures=0
unverified=0

finalize() {
  local rc=$?
  {
    printf '# Sign & Notarize\n\n'
    printf 'Generated: %s\n\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf '```text\n'
    cat "${body_file}"
    printf '```\n'
  } > "${log_md}" 2>/dev/null || true
  rm -f "${body_file}"
  exit "${rc}"
}
trap finalize EXIT

log '-- Sign & Notarize closure --'

# 0) Tools
for tool in codesign spctl lipo xcrun stapler; do
  if ! command -v "${tool}" >/dev/null 2>&1; then
    log "FAIL        required tool missing: ${tool}"
    failures=$((failures + 1))
  fi
done
if ! xcrun --find notarytool >/dev/null 2>&1; then
  log 'FAIL        required tool missing: notarytool (xcrun)'
  failures=$((failures + 1))
fi

# 1) Resolve signing identity
identity="${identity_override:-}"
if [[ -z "${identity}" ]]; then
  identity="$(release_resolve_identity)" || identity=''
fi
idents="$(release_valid_identity_count)"
if [[ -z "${identity}" ]]; then
  log "UNVERIFIED  Developer ID Application identity"
  log "            valid identities found: ${idents:-0}"
  log '            requires: a Developer ID Application certificate in the login keychain'
  log '            obtain:  https://developer.apple.com/account/resources/certificates/list'
  log '            then:    security import <cert>.p12 -k ~/Library/Keychains/login.keychain-db'
  log '            or set  CODE_SIGN_IDENTITY=<certDisplayName>'
  unverified=$((unverified + 1))
else
  log "PASS        resolved signing identity: ${identity}"
fi

# 2) Sign the universal app bundle
if [[ "${do_sign}" -eq 1 ]]; then
  if [[ ! -d "${app}" ]]; then
    log "FAIL        app bundle not found: ${app}"
    failures=$((failures + 1))
  elif [[ -z "${identity}" ]]; then
    log "UNVERIFIED  codesign (no identity) on ${app}"
    unverified=$((unverified + 1))
  else
    if codesign --force --deep --timestamp --options runtime \
        --sign "${identity}" "${app}" 2>&1 | log; then
      log "PASS        codesign --options runtime --timestamp --deep --force --sign ${identity}"
    else
      log 'FAIL        codesign failed'
      failures=$((failures + 1))
    fi
  fi
fi

# 3) Verify signature on the app bundle
sig_summary="$(release_app_signature "${app}" 2>&1)"
if [[ "${sig_summary}" == "missing" ]]; then
  log "FAIL        signature verification on ${app}"
  failures=$((failures + 1))
elif release_app_signature "${app}" >/dev/null 2>&1; then
  log "PASS        app signature verifies (${sig_summary})"
else
  log "FAIL        app signature does not verify (${sig_summary})"
  failures=$((failures + 1))
fi

# 4) Gatekeeper assessment
if release_spctl_accepts "${app}"; then
  log 'PASS        spctl --assess --type execute accepts app'
else
  log 'FAIL        spctl --assess --type execute rejected app (Gatekeeper would block)'
  failures=$((failures + 1))
fi

# 5) Notarization credentials
if release_has_notary_creds; then
  log 'PASS        notarization credentials present'
else
  log 'UNVERIFIED  notarization credentials'
  log '            requires: APPLE_TEAM_ID, APPLE_NOTARY_API_KEY, APPLE_NOTARY_KEY_ID, APPLE_NOTARY_ISSUER'
  log '            create:   https://appstoreconnect.apple.com/access/api'
  unverified=$((unverified + 1))
fi

# 6) Notarize + staple (only attempt when DMG exists and creds present)
if [[ ! -f "${dmg}" ]]; then
  log "UNVERIFIED  notarization (no DMG at ${dmg})"
  log '            requires: a built DMG; run scripts/build-universal.sh first'
  unverified=$((unverified + 1))
elif ! release_has_notary_creds; then
  log 'UNVERIFIED  notarization + stapling (credentials absent)'
  unverified=$((unverified + 1))
else
  log "Submitting ${dmg} to notary..."
  if xcrun notarytool submit "${dmg}" \
      --key "${APPLE_NOTARY_API_KEY}" \
      --key-id "${APPLE_NOTARY_KEY_ID}" \
      --issuer "${APPLE_NOTARY_ISSUER}" \
      --wait 2>&1 | log; then
    log 'PASS        notarytool submit accepted'
  else
    log 'FAIL        notarytool submit failed'
    failures=$((failures + 1))
  fi
  if xcrun stapler staple "${dmg}" 2>&1 | log; then
    log 'PASS        stapler staple succeeded'
  else
    log 'FAIL        stapler staple failed'
    failures=$((failures + 1))
  fi
  if xcrun stapler validate "${dmg}" 2>&1 | log; then
    log 'PASS        stapler validate succeeded'
  else
    log 'FAIL        stapler validate failed'
    failures=$((failures + 1))
  fi
fi

release_summary "${failures}" "${unverified}" | tee -a "${body_file}"
if [[ "${failures}" -gt 0 ]]; then
  exit 1
fi
if [[ "${unverified}" -gt 0 ]]; then
  exit 2
fi
exit 0