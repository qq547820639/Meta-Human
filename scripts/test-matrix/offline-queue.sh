#!/usr/bin/env bash
#
# offline-queue.sh — offline request queue logic test.
#
# The offline queue is a frontend module (apps/desktop/src/features/reliability/
# offlineQueue.ts). There is no live sidecar queue to exercise, so we run the
# existing vitest unit suite for it as evidence. The item is therefore PASS at
# the unit level (labelled as such) — it is not a live end-to-end run.

set -euo pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/lib.sh"

begin

set +e
pnpm --dir "${TM_PROJECT_ROOT}/apps/desktop" exec vitest run \
  src/features/reliability/offlineQueue.test.ts \
  > "${TM_EVIDENCE_DIR}/${TM_NAME}.log" 2>&1
rc=$?
set -e

if [[ "${rc}" -eq 0 ]]; then
  result PASS network "offline queue logic PASS (unit-level via vitest; no live sidecar queue)"
else
  result FAIL network "offline queue unit tests failed (rc=${rc}); see evidence log"
fi
exit 0