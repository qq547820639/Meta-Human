#!/usr/bin/env bash
#
# release-provenance.sh
#
# Generates artifact provenance for a VoxStudio release: a SHA256SUMS file and
# a provenance.json carrying the app version, the git commit SHA, the build
# time (ISO 8601 UTC), the sha256 checksum of every produced artifact, and an
# honest sign/notarize status.
#
# Honesty rule (mirrors lib/release-common.sh): we never claim a build is
# signed or notarized unless an explicit env flag says so. When no flag is set
# the status is recorded as "undetermined"; an explicit SIGNED=0/false is
# recorded as "unsigned". We do not fabricate a PASS.
#
# Usage:
#   scripts/release-provenance.sh [--output-dir DIR] [ARTIFACT ...]
#
# Options:
#   --output-dir DIR  Where to write SHA256SUMS and provenance.json
#                     (default: <project>/output).
#   ARTIFACT ...      Extra artifact files to checksum (optional). The default
#                     set covers the universal DMG, the sidecar and desktop
#                     binaries, and the two executables inside the app bundle.
#
# Sign / notarize status is taken from these env flags (any of 1/true/yes):
#   SIGNED     whether the build was codesigned with a Developer ID identity
#   NOTARIZED  whether the build was notarized and stapled
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
while [[ $# -gt 0 ]]; do
  case "$1" in
    --output-dir) output_dir="$2"; shift 2 ;;
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
# Sign / notarize status (honest: only trust explicit flags)
# ---------------------------------------------------------------------------
flag_on() { [[ "${1:-}" =~ ^(1|true|yes)$ ]]; }
if flag_on "${SIGNED:-}" && flag_on "${NOTARIZED:-}"; then
  status="signed+notarized"
elif flag_on "${SIGNED:-}"; then
  status="signed (not notarized)"
elif [[ "${SIGNED:-}" =~ ^(0|false|no)$ ]]; then
  status="unsigned"
else
  status="undetermined"
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
python3 - "${provenance_file}" "${output_dir}" "${version}" "${commit}" "${build_time}" "${status}" <<'PY'
import json, os, sys, glob

provenance_file, output_dir, version, commit, build_time, status = sys.argv[1:]
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
    "sign_status": status,
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
printf '  sign_status  : %s\n' "${status}"
printf '  artifacts    : %d (missing %d)\n' "${#artifacts[@]}" "${missing}"

if [[ "${missing}" -gt 0 ]]; then
  printf 'note: %d artifact(s) were missing; see SHA256SUMS "MISSING" lines\n' "${missing}" >&2
fi
exit 0