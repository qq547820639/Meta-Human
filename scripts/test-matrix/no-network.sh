#!/usr/bin/env bash
#
# no-network.sh — near-real offline/degraded startup test (simulated).
#
# We must NOT disable the machine's actual network. Instead we simulate an
# offline environment by pointing every outbound provider at an unreachable
# loopback endpoint (127.0.0.1:1) and confirm the sidecar still starts and
# reports healthy — i.e. startup does not hard-depend on outbound network. This
# is a simulated offline, not a real network disable. If the sidecar binary is
# unavailable, the item is UNVERIFIED.

set -euo pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/lib.sh"

begin

DBDIR="$(cd "${TM_EVIDENCE_DIR}/.." && pwd -P)"
DB="${DBDIR}/no-network.sqlite3"
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
  log "status=UNVERIFIED sidecar binary unavailable; cannot simulate offline startup"
  result UNVERIFIED network "sidecar binary unavailable on this machine"
  exit 0
fi

rm -f "${DB}" "${DB}.bak."*

cat > "${PYFILE}" <<'PY'
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

DB_PATH = Path(sys.argv[1])
SIDECAR_BIN = sys.argv[2]
TOKEN = "T" * 43
# Reserved, non-loopback, unreachable address (TEST-NET-1) simulates an offline
# / no-outbound state without touching the machine's real network. It is not
# loopback, so the sidecar's SSRF guard accepts the config, but no host responds.
UNREACHABLE = "http://192.0.2.1"


def healthz(url: str) -> bool:
    req = urllib.request.Request(
        f"{url}/healthz", headers={"Authorization": f"Bearer {TOKEN}"}
    )
    try:
        with urllib.request.urlopen(req, timeout=3) as response:
            return response.status == 200
    except (urllib.error.HTTPError, OSError):
        return False


sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
sock.bind(("127.0.0.1", 0))
sock.listen(16)
url = f"http://127.0.0.1:{sock.getsockname()[1]}"
os.dup2(sock.fileno(), 9)

env = os.environ.copy()
env["VOXSTUDIO_BEARER_TOKEN"] = TOKEN
# allow_remote must be set so the non-loopback TEST-NET-1 base URL passes
# LocalProviderConfig validation (loopback-only by default). TEST-NET-1 is
# reserved and unreachable, so no host responds — true simulated offline.
env["VOXSTUDIO_LOCAL_ALLOW_REMOTE"] = "1"
# Every outbound provider points at an unreachable endpoint (simulated offline).
env["VOXSTUDIO_LOCAL_BASE_URL"] = UNREACHABLE
env["VOXSTUDIO_LOCAL_CHAT_MODEL"] = "offline-chat"
env["VOXSTUDIO_LOCAL_EMBEDDING_MODEL"] = "offline-embed"
env["VOXSTUDIO_LOCAL_STT_MODEL"] = "offline-stt"
env["VOXSTUDIO_REMOTE_BASE_URL"] = UNREACHABLE
env["VOXSTUDIO_FEISHU_ACCESS_TOKEN"] = "mock-token"
env["VOXSTUDIO_FEISHU_SPACE_ID"] = "space-1"
env["VOXSTUDIO_FEISHU_BASE_URL"] = UNREACHABLE

log_path = DB_PATH.with_name("no-network.log")

with log_path.open("wb") as log_file:
    proc = subprocess.Popen(
        [SIDECAR_BIN, "--listener-fd", "9", "--database", str(DB_PATH)],
        env=env,
        stdin=subprocess.DEVNULL,
        stdout=log_file,
        stderr=subprocess.STDOUT,
        close_fds=False,
    )

healthy = False
for _ in range(60):
    if proc.poll() is not None:
        break
    if healthz(url):
        healthy = True
        break
    time.sleep(0.25)

print(f"sidecar_started_without_network={healthy}")
if healthy:
    print("NO_NETWORK_OK")

proc.terminate()
try:
    proc.wait(timeout=5)
except subprocess.TimeoutExpired:
    proc.kill()
    proc.wait()
sock.close()

raise SystemExit(0 if healthy else 1)
PY

if ! uv run --project "${TM_PROJECT_ROOT}/apps/sidecar" python3 \
  "${PYFILE}" "${DB}" "${SIDECAR_BIN}" \
  > "${TM_EVIDENCE_DIR}/${TM_NAME}.log" 2>&1; then
  result FAIL network "sidecar failed to start against unreachable providers (simulated offline); see evidence log"
  rm -f "${PYFILE}"
  exit 0
fi
rm -f "${PYFILE}"

result PASS network "sidecar starts healthy with providers unreachable (simulated offline; real network not disabled)"
exit 0