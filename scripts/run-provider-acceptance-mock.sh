#!/usr/bin/env bash
# Run the provider acceptance executor against a local mock provider server, in
# mock-harness mode. This is the CI-controlled smoke: it makes the acceptance
# executor genuinely exercise the local / remote / Feishu categories against a
# reachable loopback service, but the generated report is stamped
# verification_kind=mock-harness (VOXSTUDIO_MOCK_PROVIDER=1) so it can never be
# mistaken for a real-credentials pass.
#
# The server is started on an ephemeral port and torn down in a trap. The
# executor's exit code is honored: any FAIL fails this script (real failures are
# never downgraded to PASS).
#
# Usage:
#   uv run --project apps/sidecar python scripts/mock-provider-server.py &  # (not needed)
#   bash scripts/run-provider-acceptance-mock.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="${ROOT}/output/mock-provider-server.log"
mkdir -p "${ROOT}/output"

PORT=""
SERVER_PID=""

cleanup() {
  if [ -n "${SERVER_PID}" ] && kill -0 "${SERVER_PID}" 2>/dev/null; then
    kill "${SERVER_PID}" 2>/dev/null || true
    wait "${SERVER_PID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

echo "==> Starting mock provider server (ephemeral port)"
uv run --project "${ROOT}/apps/sidecar" python "${ROOT}/scripts/mock-provider-server.py" \
  > "${ROOT}/output/mock-provider-server.out" 2>>"${LOG}" &
SERVER_PID=$!

# Read the chosen port from the server's handshake line.
for _ in $(seq 1 60); do
  if [ -f "${ROOT}/output/mock-provider-server.out" ]; then
    PORT="$(sed -n 's/^MOCK_PROVIDER_PORT=//p' "${ROOT}/output/mock-provider-server.out" | head -n1)"
    if [ -n "${PORT}" ]; then
      break
    fi
  fi
  if ! kill -0 "${SERVER_PID}" 2>/dev/null; then
    echo "ERROR: mock provider server exited during startup" >&2
    tail -n 40 "${LOG}" >&2 || true
    exit 1
  fi
  sleep 0.25
done

if [ -z "${PORT}" ]; then
  echo "ERROR: did not receive PORT from mock server" >&2
  tail -n 40 "${LOG}" >&2 || true
  exit 1
fi
echo "==> Mock provider server listening on 127.0.0.1:${PORT}"

export VOXSTUDIO_MOCK_PROVIDER="1"
export VOXSTUDIO_ALLOW_LOOPBACK_PROVIDERS="1"
export VOXSTUDIO_LOCAL_BASE_URL="http://127.0.0.1:${PORT}"
export VOXSTUDIO_LOCAL_CHAT_MODEL="mock-chat"
export VOXSTUDIO_LOCAL_EMBEDDING_MODEL="mock-embed"
export VOXSTUDIO_LOCAL_STT_MODEL="mock-stt"
export VOXSTUDIO_REMOTE_BASE_URL="http://127.0.0.1:${PORT}"
export VOXSTUDIO_REMOTE_API_KEY="mock-key"
export VOXSTUDIO_FEISHU_APP_ID="cli_mock"
export VOXSTUDIO_FEISHU_APP_SECRET="mock-secret"
export VOXSTUDIO_FEISHU_SPACE_ID="space-1"
export VOXSTUDIO_FEISHU_ACCESS_TOKEN="mock-token"
export VOXSTUDIO_FEISHU_BASE_URL="http://127.0.0.1:${PORT}"

echo "==> Running provider acceptance executor (mock-harness mode)"
uv run --project "${ROOT}/apps/sidecar" python \
  "${ROOT}/scripts/accept-providers/accept_providers.py" \
  --json "${ROOT}/output/provider-acceptance-mock-harness.json" \
  --md "${ROOT}/output/provider-acceptance-mock-harness.md"