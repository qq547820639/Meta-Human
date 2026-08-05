#!/usr/bin/env bash
#
# release-provenance.sh
#
# Generates artifact provenance for a VoxStudio release: a SHA256SUMS file and
# a provenance.json carrying the app version, the git commit SHA, the build
# time (ISO 8601 UTC), the sha256 checksum of every produced artifact, and an
# honest sign/notarize status.
#
# Honesty rule (mirrors scripts/verify-release.sh): we never claim a build is
# signed or notarized from the mere presence of credentials. The sign status is
# taken ONLY from real tool verification (codesign --verify --deep --strict +
# spctl --assess, and — when notary credentials are present — xcrun notarytool
# submit + xcrun stapler validate). That verification is produced by
# scripts/verify-release.sh and injected here via `--verify-json FILE`. When no
# verification result is available the status is recorded as "unverified" with a
# warning; we do not fabricate a PASS.
#
# Usage:
#   scripts/release-provenance.sh [--output-dir DIR] [--verify-json FILE] [ARTIFACT ...]
#
# Options:
#   --output-dir DIR  Where to write SHA256SUMS and provenance.json
#                     (default: <project>/output).
#   --verify-json FILE  JSON produced by scripts/verify-release.sh carrying the
#                     real signed/notarized status and per-check results.
#   ARTIFACT ...      Extra artifact files to checksum (optional). The default
#                     set covers the universal DMG, the sidecar and desktop
#                     binaries, and the two executables inside the app bundle.
#
# Sign status resolution (in order of trust):
#   1. If --verify-json points to a real verify-release.sh result, its `status`
#      ("notarized" / "signed" / "unverified") is used verbatim and the check
#      details are embedded in provenance.json.
#   2. Otherwise, if a built .app/.dmg exist, this script invokes
#      scripts/verify-release.sh itself to obtain a real result.
#   3. Otherwise the status is "unverified" with a clear warning.
#
# Exit codes:
#   0  all gathered artifacts were checksummed
#   2  usage error

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
project_root="$(cd -- "${script_dir}/.." && pwd -P)"
desktop_project="${project_root}/apps/desktop"

output_dir="${project_root}/output"

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  sed -n '2,40p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit 0
fi

extra_artifacts=()
verify_json=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --output-dir) output_dir="$2"; shift 2 ;;
    --verify-json) verify_json="$2"; shift 2 ;;
    --) shift; break ;;
    -*) printf 'error: unknown option: %s\n' "$1" >&2; exit 2 ;;
    *) extra_artifacts+=("$1"); shift ;;
  esac
done
# trailing ARTIFACT args after -- (or any remaining positional args)
while [[ $# -gt 0 ]]; do
  extra_artifacts+=("$1"); shift
done

mkdir -p "${output_dir}"

# ---------------------------------------------------------------------------
# Version (from tauri.conf.json, falling back to Cargo.toml)
# ---------------------------------------------------------------------------
version=""
if [[ -f "${desktop_project}/src-tauri/tauri.conf.json" ]]; then
  version="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("version",""))' \
    "${desktop_project}/src-tauri/tauri.conf.json" 2>/dev/null || true)"
fi
if [[ -z "${version}" && -f "${desktop_project}/src-tauri/Cargo.toml" ]]; then
  version="$(awk -F= '/^[[:space:]]*version[[:space:]]*=[[:space:]]*"/{gsub(/[ "]/,"",$2);print $2;exit}' \
    "${desktop_project}/src-tauri/Cargo.toml" 2>/dev/null || true)"
fi
version="${version:-unknown}"

# ---------------------------------------------------------------------------
# git commit SHA + build time
# ---------------------------------------------------------------------------
commit="$(git -C "${project_root}" rev-parse HEAD 2>/dev/null || true)"
commit="${commit:-unknown}"
build_time="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# ---------------------------------------------------------------------------
# Default artifact set (only existing files are used; missing ones are listed)
# ---------------------------------------------------------------------------
bundle_dmg="${desktop_project}/src-tauri/target/universal-apple-darwin/release/bundle/dmg"
default_artifacts=(
  "${bundle_dmg}"/VoxStudio_${version}_universal.dmg
  "${output_dir}/VoxStudio-universal.dmg"
  "${desktop_project}/src-tauri/binaries/digital-human-sidecar-universal-apple-darwin"
  "${desktop_project}/src-tauri/target/universal-apple-darwin/release/voxstudio-desktop"
  "${desktop_project}/src-tauri/target/universal-apple-darwin/release/bundle/macos/VoxStudio.app/Contents/MacOS/voxstudio-desktop"
  "${desktop_project}/src-tauri/target/universal-apple-darwin/release/bundle/macos/VoxStudio.app/Contents/MacOS/digital-human-sidecar"
)

# De-duplicate: keep the first occurrence of each resolved path.
# NOTE: `${extra_artifacts[@]+"${extra_artifacts[@]}"}` keeps `set -u` happy on
# macOS bash 3.2 when the extra-artifact array is empty.
artifacts=()
seen=" "
for p in "${default_artifacts[@]}" ${extra_artifacts[@]+"${extra_artifacts[@]}"}; do
  resolved="$(cd -- "$(dirname -- "${p}")" 2>/dev/null && pwd -P)/$(basename -- "${p}")" || resolved="${p}"
  if [[ "${seen}" != *" ${resolved} "* ]]; then
    artifacts+=("${resolved}")
    seen="${seen}${resolved} "
  fi
done

# ---------------------------------------------------------------------------
# Sign / notarize status (honest: ONLY from real tool verification)
# ---------------------------------------------------------------------------
verify_data=""
sign_status="unverified"

extract_status() {
  printf '%s' "${verify_data}" | python3 -c 'import json,sys
try:
    print(json.load(sys.stdin).get("status", "unverified"))
except Exception:
    print("unverified")' 2>/dev/null || printf 'unverified'
}

if [[ -n "${verify_json}" && -f "${verify_json}" ]]; then
  verify_data="$(cat "${verify_json}")"
  sign_status="$(extract_status)"
elif [[ -n "${verify_json}" ]]; then
  printf 'warning: --verify-json file not found: %s; recording UNVERIFIED\n' "${verify_json}" >&2
  verify_data="{\"ran\": false, \"reason\": \"--verify-json file not found: ${verify_json}\"}"
else
  # No explicit result: try to run the real verification helper against the
  # built artifacts. Only when that succeeds do we trust a signed/notarized
  # status; otherwise we record UNVERIFIED and never claim signed/notarized.
  app_candidate="${desktop_project}/src-tauri/target/universal-apple-darwin/release/bundle/macos/VoxStudio.app"
  dmg_candidate="${bundle_dmg}/VoxStudio_${version}_universal.dmg"
  [[ -f "${dmg_candidate}" ]] || dmg_candidate="${output_dir}/VoxStudio-universal.dmg"
  if [[ -x "${script_dir}/verify-release.sh" && -d "${app_candidate}" ]]; then
    verify_data="$("${script_dir}/verify-release.sh" --app "${app_candidate}" --dmg "${dmg_candidate}" 2>/dev/null || true)"
    if [[ -n "${verify_data}" ]]; then
      sign_status="$(extract_status)"
    fi
  fi
  if [[ -z "${verify_data}" ]]; then
    verify_data='{"ran": false, "reason": "real codesign/spctl/notarytool verification could not run (no built artifacts / no credentials)"}'
    sign_status="unverified"
    printf 'warning: no real codesign/spctl/notarytool verification ran; recording UNVERIFIED (never claims signed/notarized)\n' >&2
  fi
fi

# ---------------------------------------------------------------------------
# Write SHA256SUMS
# ---------------------------------------------------------------------------
sums_file="${output_dir}/SHA256SUMS"
: > "${sums_file}"
missing=0
for p in "${artifacts[@]}"; do
  if [[ -f "${p}" ]]; then
    shasum -a 256 "${p}" | awk '{print $1"  "$2}' >> "${sums_file}"
  else
    printf 'MISSING  %s\n' "${p}" >> "${sums_file}"
    missing=$((missing + 1))
  fi
done

# ---------------------------------------------------------------------------
# Write provenance.json
# ---------------------------------------------------------------------------
provenance_file="${output_dir}/provenance.json"
python3 - "${provenance_file}" "${output_dir}" "${version}" "${commit}" "${build_time}" "${sign_status}" "${verify_data}" <<'PY'
import json, os, sys

provenance_file, output_dir, version, commit, build_time, sign_status = sys.argv[1:7]
verify_data = json.loads(sys.argv[7]) if len(sys.argv) > 7 and sys.argv[7] else {"ran": False, "reason": "no verification data"}
sums = {}
for line in open(os.path.join(output_dir, "SHA256SUMS"), encoding="utf-8"):
    line = line.rstrip("\n")
    if not line:
        continue
    if line.startswith("MISSING"):
        sums[line.split("  ", 1)[1]] = None
        continue
    alg, _, path = line.partition("  ")
    sums[path] = alg
artifacts = [{"path": p, "sha256": d} for p, d in sorted(sums.items())]
provenance = {
    "app": "VoxStudio",
    "version": version,
    "commit_sha": commit,
    "build_time_utc": build_time,
    "sign_status": sign_status,
    "verification": verify_data,
    "artifact_count": len(artifacts),
    "missing_artifact_count": sum(1 for a in artifacts if a["sha256"] is None),
    "artifacts": artifacts,
}
with open(provenance_file, "w", encoding="utf-8") as fh:
    json.dump(provenance, fh, indent=2, ensure_ascii=False)
    fh.write("\n")
PY

printf 'Provenance written to %s and %s\n' "${sums_file}" "${provenance_file}"
printf '  version      : %s\n' "${version}"
printf '  commit_sha   : %s\n' "${commit}"
printf '  build_time   : %s\n' "${build_time}"
printf '  sign_status  : %s\n' "${sign_status}"
printf '  artifacts    : %d (missing %d)\n' "${#artifacts[@]}" "${missing}"

if [[ "${missing}" -gt 0 ]]; then
  printf 'note: %d artifact(s) were missing; see SHA256SUMS "MISSING" lines\n' "${missing}" >&2
fi
exit 0