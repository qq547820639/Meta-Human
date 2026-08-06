#!/usr/bin/env bash
#
# sidecar-crash.sh — near-real sidecar crash/restart test.
#
# Launches the real packaged sidecar binary, verifies it is healthy, seeds a
# resumable (RUNNING) build job, kills it abruptly (SIGKILL), relaunches it on
# the same database, verifies it comes back healthy, and confirms the resumable
# build job is still visible. If the sidecar binary is unavailable this item is
# recorded as UNVERIFIED (never faked as PASS).

set -euo pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/lib.sh"

begin

SIDECAR_SRC="${TM_PROJECT_ROOT}/apps/sidecar/src"
DBDIR="$(cd "${TM_EVIDENCE_DIR}/.." && pwd -P)"
DB="${DBDIR}/sidecar-crash.sqlite3"
PYFILE="${TM_EVIDENCE_DIR}/${TM_NAME}.py"
BINARIES="${TM_PROJECT_ROOT}/apps/desktop/src-tauri/binaries"

SIDECAR_BIN=""
for candidate in \
  "${BINARIES}/digital-human-sidecar-aarch64-apple-darwin" \
  "${BINARIES}/digital-human-sidecar-x86_64-apple-darwin" \
  "${BINARIES}/digital-human-sidecar-universal-apple-darwin"; do
  if [[ -x "${candidate}" ]]; then
    SIDECAR_BIN="${candidate}"
    break
  fi
done

if [[ -z "${SIDECAR_BIN}" ]]; then
  log "status=UNVERIFIED sidecar binary unavailable; cannot run crash/restart test"
  log "expected_binary_dir=${BINARIES}"
  result UNVERIFIED crash "sidecar binary unavailable on this machine (build with scripts/build-sidecar.sh)"
  exit 0
fi

rm -f "${DB}" "${DB}.bak."*

cat > "${PYFILE}" <<'PY'
import asyncio
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, sys.argv[2])
from voxstudio_core.persistence.database import Database
from voxstudio_core.persistence.build_job_repository import (
    BuildJobRepository,
    BuildJobStatus,
)
from voxstudio_core.persistence.digital_human_repository import (
    DigitalHumanRepository,
)

DB_PATH = Path(sys.argv[1])
SIDECAR_BIN = sys.argv[3]
TOKEN = "T" * 43
RESUMABLE_JOB_ID = "resumable-job-1"


def healthz(url: str) -> bool:
    req = urllib.request.Request(
        f"{url}/healthz", headers={"Authorization": f"Bearer {TOKEN}"}
    )
    try:
        with urllib.request.urlopen(req, timeout=3) as response:
            return response.status == 200
    except (urllib.error.HTTPError, OSError):
        return False


async def seed_resumable_job() -> None:
    db = Database(DB_PATH)
    await db.migrate()
    humans = DigitalHumanRepository(db)
    await humans.create(name="Crash Human", digital_human_id="crash-human-1")
    jobs = BuildJobRepository(db)
    job = await jobs.create(
        portrait_path="/tmp/crash-portrait.png",
        recording_path="/tmp/crash-recording.wav",
        digital_human_id="crash-human-1",
        job_id=RESUMABLE_JOB_ID,
    )
    await jobs.update(job.id, status=BuildJobStatus.RUNNING)
    await db.close()


def spawn(sock: socket.socket, env: dict[str, str], log_path: Path) -> subprocess.Popen:
    os.dup2(sock.fileno(), 9)
    with log_path.open("wb") as log_file:
        return subprocess.Popen(
            [SIDECAR_BIN, "--listener-fd", "9", "--database", str(DB_PATH)],
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=log_file,
            stderr=subprocess.STDOUT,
            close_fds=False,
        )


def wait_healthy(proc: subprocess.Popen, url: str) -> bool:
    for _ in range(60):
        if proc.poll() is not None:
            return False
        if healthz(url):
            return True
        time.sleep(0.25)
    return False


async def resumable_job_visible() -> bool:
    db = Database(DB_PATH)
    await db.migrate()
    jobs = BuildJobRepository(db)
    unfinished = await jobs.list_unfinished()
    await db.close()
    return any(job.id == RESUMABLE_JOB_ID for job in unfinished)


def main() -> int:
    asyncio.run(seed_resumable_job())

    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(("127.0.0.1", 0))
    sock.listen(16)
    url = f"http://127.0.0.1:{sock.getsockname()[1]}"

    env = os.environ.copy()
    env["VOXSTUDIO_BEARER_TOKEN"] = TOKEN

    log_path = DB_PATH.with_name("sidecar-crash.log")

    proc = spawn(sock, env, log_path)
    if not wait_healthy(proc, url):
        print("first_launch=not_healthy")
        return 1
    print("first_launch=healthy")

    # Abrupt kill (SIGKILL) — no graceful shutdown.
    proc.kill()
    proc.wait()

    proc2 = spawn(sock, env, log_path)
    if not wait_healthy(proc2, url):
        print("relaunch=not_healthy")
        return 1
    print(f"relaunch=healthy pid={proc2.pid}")

    visible = asyncio.run(resumable_job_visible())
    print(f"resumable_job_visible={visible} job_id={RESUMABLE_JOB_ID}")
    if not visible:
        return 1

    proc2.terminate()
    try:
        proc2.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc2.kill()
        proc2.wait()
    sock.close()
    print("CRASH_OK")
    return 0


raise SystemExit(main())
PY

if ! uv run --project "${TM_PROJECT_ROOT}/apps/sidecar" python3 \
  "${PYFILE}" "${DB}" "${SIDECAR_SRC}" "${SIDECAR_BIN}" \
  > "${TM_EVIDENCE_DIR}/${TM_NAME}.log" 2>&1; then
  result FAIL crash "sidecar crash/restart did not recover; see evidence log"
  rm -f "${PYFILE}"
  exit 0
fi
rm -f "${PYFILE}"

result PASS crash "sidecar healthy after SIGKILL + relaunch; resumable build job visible"
exit 0