#!/usr/bin/env bash
#
# permission.sh — macOS mic/camera permission & device presence test.
#
# Reports PASS/FAIL for device presence (camera + microphone) via
# `system_profiler`, mirroring scripts/smoke-capture.sh. The permission
# grant/deny/re-auth flow requires GUI interaction and is therefore recorded as
# UNVERIFIED in the evidence.

set -euo pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/lib.sh"

begin

failures=0

camera="$(system_profiler SPCameraDataType 2>/dev/null || true)"
if [[ "${camera}" == *"Camera"* || "${camera}" == *"camera"* ]]; then
  log "camera_device=present"
else
  log "camera_device=absent"
  failures=$((failures + 1))
fi

audio="$(system_profiler SPAudioDataType 2>/dev/null || true)"
if [[ "${audio}" == *"Microphone"* ||
      "${audio}" == *"microphone"* ||
      "${audio}" == *"Input Channels"* ||
      "${audio}" == *"麦克风"* ]]; then
  log "microphone_device=present"
else
  log "microphone_device=absent"
  failures=$((failures + 1))
fi

log "permission_grant_deny_reauth=UNVERIFIED (requires GUI interaction)"
log "permission_state_via_app=UNVERIFIED (requires the running desktop app)"

if [[ "${failures}" -eq 0 ]]; then
  result PASS permission "camera + microphone devices present; grant/deny/re-auth flow UNVERIFIED (GUI)"
else
  result FAIL permission "one or more capture devices not reported; see evidence log"
fi
exit 0