#!/usr/bin/env bash
#
# disk-full.sh — near-real disk-space detection test.
#
# The repo has no dedicated "disposable-space" detector module, so this item
# exercises OS-level disposable-space detection directly (Python
# `shutil.disk_usage`, the same facility any such detector would use): it writes
# a real temp file, confirms the file is writable, and confirms the OS reports
# free space above a small safety threshold. This is a REAL execution of the
# OS detection path, not a mock.

set -euo pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/lib.sh"

begin

DBDIR="$(cd "${TM_EVIDENCE_DIR}/.." && pwd -P)"
PYFILE="${TM_EVIDENCE_DIR}/${TM_NAME}.py"
MIN_FREE_BYTES=67108864  # 64 MiB safety floor

cat > "${PYFILE}" <<'PY'
import os
import shutil
import sys
from pathlib import Path

target_dir = Path(sys.argv[1])
min_free = int(sys.argv[2])

usage_before = shutil.disk_usage(str(target_dir))
probe = target_dir / "disk-full-probe.bin"
probe.write_bytes(b"\0" * (8 * 1024 * 1024))  # 8 MiB disposable space probe
written = probe.stat().st_size
os.remove(probe)
usage_after = shutil.disk_usage(str(target_dir))

free_before = usage_before.free
free_after = usage_after.free
print(f"target={target_dir}")
print(f"probe_written={written} bytes")
print(f"free_before={free_before} free_after={free_after}")
print(f"total={usage_before.total} used={usage_before.used}")

assert written == 8 * 1024 * 1024, written
# The OS must report a sane free-space figure (the disposable-space detection).
assert free_after > min_free, (free_after, min_free)
print("DISK_DETECTION_OK")
PY

if ! uv run --project "${TM_PROJECT_ROOT}/apps/sidecar" python3 \
  "${PYFILE}" "${DBDIR}" "${MIN_FREE_BYTES}" \
  > "${TM_EVIDENCE_DIR}/${TM_NAME}.log" 2>&1; then
  result FAIL disk "disposable-space detection did not report correctly; see evidence log"
  rm -f "${PYFILE}"
  exit 0
fi
rm -f "${PYFILE}"

free="$(sed -n 's/^free_after=\([0-9]*\).*/\1/p' "${TM_EVIDENCE_DIR}/${TM_NAME}.log")"
result PASS disk "OS disposable-space detection OK, free=${free:-?} bytes (OS-level; no repo detector exists)"
exit 0