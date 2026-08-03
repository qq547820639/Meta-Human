#!/usr/bin/env bash

set -euo pipefail

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  cat <<'EOF'
Usage: scripts/smoke-capture.sh

Reports whether macOS reports a camera and microphone. Permission state is read by
the app through `capture_permission_status`.

Exit code 0 only when both devices are present.
EOF
  exit 0
fi

failures=0

check_camera() {
  local output
  output="$(system_profiler SPCameraDataType 2>/dev/null || true)"
  if [[ "${output}" == *"Camera"* || "${output}" == *"camera"* ]]; then
    printf 'PASS  camera device is present\n'
  else
    printf 'FAIL  camera device was not reported\n'
    failures=$((failures + 1))
  fi
}

check_microphone() {
  local output
  output="$(system_profiler SPAudioDataType 2>/dev/null || true)"
  if [[ "${output}" == *"Microphone"* ||
        "${output}" == *"microphone"* ||
        "${output}" == *"Input Channels"* ||
        "${output}" == *"麦克风"* ]]; then
    printf 'PASS  microphone device is present\n'
  else
    printf 'FAIL  microphone device was not reported\n'
    failures=$((failures + 1))
  fi
}

printf '%s\n' '-- Capture device smoke --'
check_camera
check_microphone

if [[ "${failures}" -eq 0 ]]; then
  printf '%s\n' 'Capture device smoke PASSED.'
  exit 0
fi
printf '%s\n' 'Capture device smoke FAILED.'
exit 1
