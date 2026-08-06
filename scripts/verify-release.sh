#!/usr/bin/env bash
#
# verify-release.sh
#
# Verifies a built VoxStudio .app and .dmg using the REAL macOS code-signing,
# Gatekeeper and notarization tools, and emits a machine-readable JSON result
# that the release pipeline can trust. This is the single source of truth for
# whether a build is "signed" / "notarized" / "unverified".
#
# What it runs:
#   signed     <- `codesign --verify --deep --strict <app>` AND
#                 `spctl --assess --type execute <app>` both succeed
#   notarized  <- `signed` AND
#                 `xcrun notarytool submit <dmg> ... --wait` succeeds AND
#                 `xcrun stapler staple <dmg>` / `xcrun stapler validate <dmg>` succeed
#
# Honesty rule: we NEVER claim signed/notarized from the mere presence of
# credentials. Each flag is set only when the corresponding tool actually
# passed. If a tool could not run (missing binary, missing artifact, missing
# notary credentials) its check is recorded as `ran: false` and the final
# status degrades to "signed" or "unverified" accordingly.
#
# Notarization requires these env vars (same as scripts/release-dmg.sh):
#   APPLE_TEAM_ID, APPLE_NOTARY_API_KEY, APPLE_NOTARY_KEY_ID, APPLE_NOTARY_ISSUER
#
# Usage:
#   scripts/verify-release.sh [--app PATH] [--dmg PATH] [--output-dir DIR]
#
# Options:
#   --app PATH       Path to the built .app bundle (default: auto-detect from
#                    the universal bundle output).
#   --dmg PATH       Path to the built .dmg (default: auto-detect).
#   --output-dir DIR Directory to also write verify.json (optional; JSON is
#                    always printed to stdout).
#
# Exit codes:
#   0  verification completed (the JSON `status` field has the honest result)
#   2  usage error / required tool missing (codesign, spctl or notarytool)
#
# The JSON status is one of:
#   "notarized"  codesign + spctl + notarytool + stapler all passed
#   "signed"     codesign + spctl passed (not notarized / no credentials)
#   "unverified" one or more required checks failed or could not be run

set -uo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
project_root="$(cd -- "${script_dir}/.." && pwd -P)"
desktop_project="${project_root}/apps/desktop"

app=""
dmg=""
output_dir=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app) app="$2"; shift 2 ;;
    --dmg) dmg="$2"; shift 2 ;;
    --output-dir) output_dir="$2"; shift 2 ;;
    --help|-h)
      sed -n '2,60p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    -*) printf 'error: unknown option: %s\n' "$1" >&2; exit 2 ;;
    *) printf 'error: unexpected argument: %s\n' "$1" >&2; exit 2 ;;
  esac
done

# Auto-detect default artifacts. Prefer the universal bundle when it exists;
# otherwise fall back to the native (arm64) release bundle so the honest
# verification runs against whatever the release gate actually produced.
if [[ -z "${app}" ]]; then
  app="${desktop_project}/src-tauri/target/universal-apple-darwin/release/bundle/macos/VoxStudio.app"
  if [[ ! -d "${app}" ]]; then
    app="${desktop_project}/src-tauri/target/release/bundle/macos/VoxStudio.app"
  fi
fi
if [[ -z "${dmg}" ]]; then
  dmg="$(find "${desktop_project}/src-tauri/target/universal-apple-darwin/release/bundle/dmg" \
    -maxdepth 1 -name '*.dmg' -print -quit 2>/dev/null || true)"
  if [[ -z "${dmg}" ]]; then
    dmg="$(find "${desktop_project}/src-tauri/target/release/bundle/dmg" \
      -maxdepth 1 -name '*.dmg' -print -quit 2>/dev/null || true)"
  fi
fi

# Required tools must exist; otherwise we cannot verify anything honestly.
for tool in codesign spctl; do
  if ! command -v "${tool}" >/dev/null 2>&1; then
    printf 'error: required tool not found: %s\n' "${tool}" >&2
    exit 2
  fi
done
if ! command -v xcrun >/dev/null 2>&1; then
  printf 'error: required tool not found: xcrun\n' >&2
  exit 2
fi

# Collect a check entry: ran/passed/command/output.
check_entry() {
  local name="$1" ran="$2" passed="$3" command="$4" output="$5"
  printf '{"name":%s,"ran":%s,"passed":%s,"command":%s,"output":%s}' \
    "$(python3 -c 'import json,sys;print(json.dumps(sys.argv[1]))' "$name")" \
    "$ran" "$passed" \
    "$(python3 -c 'import json,sys;print(json.dumps(sys.argv[1]))' "$command")" \
    "$(python3 -c 'import json,sys;print(json.dumps(sys.argv[1]))' "$output")"
}

notary_creds_present() {
  [[ -n "${APPLE_TEAM_ID:-}" && -n "${APPLE_NOTARY_API_KEY:-}" \
     && -n "${APPLE_NOTARY_KEY_ID:-}" && -n "${APPLE_NOTARY_ISSUER:-}" ]]
}

warnings=()

# --- codesign verify ---------------------------------------------------------
codesign_cmd="codesign --verify --deep --strict ${app}"
codesign_pass="false"; codesign_out=""
if [[ -d "${app}" ]]; then
  codesign_out="$(codesign --verify --deep --strict "${app}" 2>&1 || true)"
  if [[ -z "${codesign_out}" ]]; then
    codesign_pass="true"
  else
    warnings+=("codesign --verify --deep --strict reported findings on ${app}")
  fi
else
  codesign_out="app bundle not found: ${app}"
  warnings+=("app bundle missing: ${app}")
fi

# --- spctl assess ------------------------------------------------------------
spctl_cmd="spctl --assess --type execute ${app}"
spctl_pass="false"; spctl_out=""
if [[ -d "${app}" ]]; then
  spctl_out="$(spctl --assess --type execute "${app}" 2>&1 || true)"
  if [[ -z "${spctl_out}" ]]; then
    spctl_pass="true"
  else
    warnings+=("spctl --assess rejected ${app}")
  fi
else
  spctl_out="app bundle not found: ${app}"
fi

signed="false"
if [[ "${codesign_pass}" == "true" && "${spctl_pass}" == "true" ]]; then
  signed="true"
fi

# --- notarization (only attempted when credentials are present) --------------
notary_cmd=""; notary_pass="false"; notary_out="no notary credentials; notarization skipped (UNVERIFIED)"
stapler_cmd=""; staple_pass="false"; staple_out="not notarized; stapler not run"
notarized="false"

if notary_creds_present; then
  if [[ -n "${dmg}" && -f "${dmg}" ]]; then
    notary_cmd="xcrun notarytool submit <dmg> --key <api-key> --key-id <id> --issuer <issuer> --wait"
    notary_out="$(xcrun notarytool submit "${dmg}" \
      --key "${APPLE_NOTARY_API_KEY}" \
      --key-id "${APPLE_NOTARY_KEY_ID}" \
      --issuer "${APPLE_NOTARY_ISSUER}" \
      --wait 2>&1 || true)"
    if [[ "${notary_out}" == *"Accepted"* ]]; then
      notary_pass="true"
      # Staple + validate the DMG.
      stapler_cmd="xcrun stapler staple ${dmg}"
      staple_out="$(xcrun stapler staple "${dmg}" 2>&1 || true)"
      if [[ -z "${staple_out}" ]]; then
        staple_out="stapled"
      fi
      stapler_cmd="${stapler_cmd}; xcrun stapler validate ${dmg}"
      validate_out="$(xcrun stapler validate "${dmg}" 2>&1 || true)"
      if [[ -z "${validate_out}" ]]; then
        staple_pass="true"
      else
        staple_out="${staple_out}\n${validate_out}"
        warnings+=("stapler validate failed on ${dmg}")
      fi
    else
      warnings+=("xcrun notarytool submit did not return Accepted for ${dmg}")
    fi
  else
    notary_out="dmg not found: ${dmg:-<none>}"
    warnings+=("dmg missing: ${dmg:-<none>}")
  fi
else
  warnings+=("notarization skipped: APPLE_TEAM_ID / APPLE_NOTARY_API_KEY / APPLE_NOTARY_KEY_ID / APPLE_NOTARY_ISSUER not all set")
fi

if [[ "${signed}" == "true" && "${notary_pass}" == "true" && "${staple_pass}" == "true" ]]; then
  notarized="true"
fi

# --- status ------------------------------------------------------------------
if [[ "${notarized}" == "true" ]]; then
  status="notarized"
elif [[ "${signed}" == "true" ]]; then
  status="signed"
else
  status="unverified"
fi

python3 - "${app}" "${dmg}" "${status}" "${signed}" "${notarized}" "${output_dir}" \
  "$(check_entry codesign_verify "${codesign_pass}" "${codesign_pass}" "${codesign_cmd}" "${codesign_out}")" \
  "$(check_entry spctl_assess "${spctl_pass}" "${spctl_pass}" "${spctl_cmd}" "${spctl_out}")" \
  "$(check_entry notarytool_submit "${notary_pass}" "${notary_pass}" "${notary_cmd}" "${notary_out}")" \
  "$(check_entry stapler_validate "${staple_pass}" "${staple_pass}" "${stapler_cmd}" "${staple_out}")" \
  "$(python3 -c 'import json,sys;print(json.dumps(sys.argv[1:]))' "${warnings[@]}")" <<'PY'
import json, os, sys

app, dmg, status, signed, notarized, output_dir = sys.argv[1:7]
c_codesign, c_spctl, c_notary, c_stapler, warnings = sys.argv[7:12]
result = {
    "app": app,
    "dmg": dmg,
    "status": status,
    "signed": signed == "true",
    "notarized": notarized == "true",
    "checks": {
        "codesign_verify": json.loads(c_codesign),
        "spctl_assess": json.loads(c_spctl),
        "notarytool_submit": json.loads(c_notary),
        "stapler_validate": json.loads(c_stapler),
    },
    "warnings": json.loads(warnings),
}
out = json.dumps(result, indent=2, ensure_ascii=False) + "\n"
sys.stdout.write(out)
if output_dir:
    os.makedirs(output_dir, exist_ok=True)
    with open(os.path.join(output_dir, "verify.json"), "w", encoding="utf-8") as fh:
        fh.write(out)
PY

exit 0