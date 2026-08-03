#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
project_root="$(cd -- "${script_dir}/.." && pwd -P)"
dmg_path="${1:-${project_root}/output/VoxStudio-universal.dmg}"
mount_dir=''

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  cat <<'EOF'
Usage: scripts/smoke-dmg.sh [path-to.dmg]

Mounts the VoxStudio DMG, verifies the universal app and its signature, launches
the app, confirms the sidecar starts, quits gracefully, and confirms cleanup.
EOF
  exit 0
fi

if [[ ! -f "${dmg_path}" ]]; then
  printf 'error: DMG not found: %s\n' "${dmg_path}" >&2
  exit 1
fi

cleanup() {
  if [[ -n "${mount_dir}" ]]; then
    pkill -f "${mount_dir}/VoxStudio.app/Contents/MacOS/voxstudio-desktop" >/dev/null 2>&1 || true
    pkill -f "${mount_dir}/VoxStudio.app/Contents/MacOS/digital-human-sidecar" >/dev/null 2>&1 || true
  fi
  if [[ -n "${mount_dir}" && -d "${mount_dir}" ]]; then
    hdiutil detach "${mount_dir}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

printf 'Verifying DMG checksum...\n'
hdiutil verify "${dmg_path}" >/dev/null

mount_output="$(hdiutil attach -nobrowse -readonly "${dmg_path}" | tail -1)"
mount_dir="$(printf '%s' "${mount_output}" | awk -F '\t' '{print $3}')"
if [[ -z "${mount_dir}" || ! -d "${mount_dir}" ]]; then
  printf 'error: could not mount DMG\n' >&2
  exit 1
fi

app="${mount_dir}/VoxStudio.app"
if [[ ! -d "${app}" ]]; then
  printf 'error: VoxStudio.app is missing from the DMG\n' >&2
  exit 1
fi

for binary in \
  "${app}/Contents/MacOS/digital-human-sidecar" \
  "${app}/Contents/MacOS/voxstudio-desktop"
do
  archs="$(lipo -archs "${binary}" 2>/dev/null || true)"
  if [[ "${archs}" != *"arm64"* || "${archs}" != *"x86_64"* ]]; then
    printf 'FAIL  %s is not universal: %s\n' "${binary}" "${archs:-unknown}"
    exit 1
  fi
  printf 'PASS  %s: %s\n' "${binary##*/}" "${archs}"
done

codesign --verify --deep --strict "${app}"
printf 'PASS  app signature verifies\n'

printf 'Launching packaged app...\n'
open -n "${app}"

app_ready=0
sidecar_ready=0
for _ in $(seq 1 40); do
  if pgrep -x VoxStudio >/dev/null 2>&1 || pgrep -x voxstudio-desktop >/dev/null 2>&1; then
    app_ready=1
  fi
  if pgrep -f 'VoxStudio.app/Contents/MacOS/digital-human-sidecar' >/dev/null 2>&1 ||
     pgrep -x digital-human-sidecar >/dev/null 2>&1; then
    sidecar_ready=1
  fi
  if [[ "${app_ready}" -eq 1 && "${sidecar_ready}" -eq 1 ]]; then
    break
  fi
  sleep 0.5
done

if [[ "${app_ready}" -ne 1 ]]; then
  printf 'FAIL  packaged app did not start\n' >&2
  exit 1
fi
if [[ "${sidecar_ready}" -ne 1 ]]; then
  printf 'FAIL  packaged sidecar did not start\n' >&2
  exit 1
fi
printf 'PASS  app and sidecar started\n'

printf 'Quitting packaged app...\n'
osascript -e 'quit app id "io.voxstudio.desktop"' >/dev/null 2>&1 || true
for _ in $(seq 1 20); do
  if ! pgrep -x VoxStudio >/dev/null 2>&1 &&
     ! pgrep -x voxstudio-desktop >/dev/null 2>&1 &&
     ! pgrep -f 'VoxStudio.app/Contents/MacOS/digital-human-sidecar' >/dev/null 2>&1 &&
     ! pgrep -x digital-human-sidecar >/dev/null 2>&1; then
    printf 'PASS  app and sidecar exited\n'
    hdiutil detach "${mount_dir}" >/dev/null
    mount_dir=''
    exit 0
  fi
  sleep 0.5
done

printf 'FAIL  app or sidecar did not exit after quit\n' >&2
exit 1
