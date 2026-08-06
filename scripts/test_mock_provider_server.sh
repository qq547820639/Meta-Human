#!/usr/bin/env bash

# Automated tests for scripts/mock-provider-server.py.
#
# Starts the mock provider server on an ephemeral port and asserts every
# endpoint the product's clients dial returns the expected status/body. Uses
# bash + python3 + curl only (no new runtime dependencies). All temp files and
# processes are cleaned up on exit.

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
server_script="${script_dir}/mock-provider-server.py"
tmp="$(mktemp -d)"
failures=0
PORT=""
SERVER_PID=""

cleanup() {
  if [[ -n "${SERVER_PID}" ]] && kill -0 "${SERVER_PID}" 2>/dev/null; then
    kill "${SERVER_PID}" 2>/dev/null || true
    wait "${SERVER_PID}" 2>/dev/null || true
  fi
  rm -rf "${tmp}"
}
trap cleanup EXIT

# Start the server and read MOCK_PROVIDER_PORT from its handshake line.
python3 "${server_script}" >"${tmp}/out" 2>"${tmp}/err" &
SERVER_PID=$!
for _ in $(seq 1 50); do
  PORT="$(sed -n 's/^MOCK_PROVIDER_PORT=//p' "${tmp}/out" | head -n1)"
  [[ -n "${PORT}" ]] && break
  sleep 0.1
done
if [[ -z "${PORT}" ]]; then
  echo "FAIL  server did not report a port"
  cat "${tmp}/err" >&2 || true
  exit 1
fi
BASE="http://127.0.0.1:${PORT}"

# --- helpers ---------------------------------------------------------------
status() { # status <method> <path> [body-file]
  local method="$1" path="$2" body="${3:-}"
  if [[ -n "${body}" ]]; then
    curl --noproxy '*' -s --max-time 5 -o /dev/null -X "${method}" \
      -H "Content-Type: application/json" --data-binary "@${body}" \
      -w '%{http_code}' "${BASE}${path}"
  else
    curl --noproxy '*' -s --max-time 5 -o /dev/null -X "${method}" \
      -w '%{http_code}' "${BASE}${path}"
  fi
}

body_contains() { # body_contains <method> <path> <needle> [body-file]
  local method="$1" path="$2" needle="$3" body="${4:-}"
  local out
  if [[ -n "${body}" ]]; then
    out="$(curl --noproxy '*' -s --max-time 5 -X "${method}" \
      -H "Content-Type: application/json" --data-binary "@${body}" \
      "${BASE}${path}")"
  else
    out="$(curl --noproxy '*' -s --max-time 5 -X "${method}" "${BASE}${path}")"
  fi
  [[ "${out}" == *"${needle}"* ]]
}

check_status() {
  local name="$1" expected="$2" actual="$3"
  if [[ "${actual}" == "${expected}" ]]; then
    printf 'ok    %-46s HTTP %s\n' "${name}" "${actual}"
  else
    printf 'FAIL  %-46s expected HTTP %s, got %s\n' "${name}" "${expected}" "${actual}"
    failures=$((failures + 1))
  fi
}

check_body() {
  local name="$1" needle="$2" method="$3" path="$4" body="${5:-}"
  if body_contains "${method}" "${path}" "${needle}" "${body}"; then
    printf 'ok    %-46s contains %q\n' "${name}" "${needle}"
  else
    printf 'FAIL  %-46s missing %q\n' "${name}" "${needle}"
    failures=$((failures + 1))
  fi
}

# --- local OpenAI-compatible ------------------------------------------------
check_status "GET /api/tags" "200" "$(status GET /api/tags)"
check_body "GET /api/tags -> models" "mock-chat" GET /api/tags

echo '{"model":"mock-chat","messages":[{"role":"user","content":"hi"}]}' >"${tmp}/chat.json"
check_status "POST /v1/chat/completions" "200" "$(status POST /v1/chat/completions "${tmp}/chat.json")"
check_body "POST /v1/chat/completions -> choices" "ready" POST /v1/chat/completions "${tmp}/chat.json"

echo '{"model":"mock-embed","input":"ready"}' >"${tmp}/emb.json"
check_status "POST /v1/embeddings" "200" "$(status POST /v1/embeddings "${tmp}/emb.json")"
check_body "POST /v1/embeddings -> embedding" "0.1" POST /v1/embeddings "${tmp}/emb.json"

echo '{"model":"mock-stt"}' >"${tmp}/stt.json"
check_status "POST /v1/audio/transcriptions" "200" "$(status POST /v1/audio/transcriptions "${tmp}/stt.json")"
check_body "POST /v1/audio/transcriptions -> text" "ready" POST /v1/audio/transcriptions "${tmp}/stt.json"

# --- remote GPU --------------------------------------------------------------
check_status "GET /health" "200" "$(status GET /health)"
check_body "GET /health -> ok" "ok" GET /health

echo '{"input":"ready"}' >"${tmp}/tts.json"
check_status "POST /v1/audio/speech" "200" "$(status POST /v1/audio/speech "${tmp}/tts.json")"
check_body "POST /v1/audio/speech -> audio bytes" "RIFF-mock" POST /v1/audio/speech "${tmp}/tts.json"

echo '{"avatar_id":"a","voice_id":"v"}' >"${tmp}/stream.json"
check_status "POST /v1/avatar/streams" "200" "$(status POST /v1/avatar/streams "${tmp}/stream.json")"
check_body "POST /v1/avatar/streams -> session" "stream-mock" POST /v1/avatar/streams "${tmp}/stream.json"

check_status "DELETE /v1/avatar/streams/stream-mock" "204" "$(status DELETE /v1/avatar/streams/stream-mock)"

# --- Feishu ------------------------------------------------------------------
echo '{"app_id":"cli_mock","app_secret":"s"}' >"${tmp}/tenant.json"
check_status "POST tenant_access_token" "200" "$(status POST /open-apis/auth/v3/tenant_access_token/internal "${tmp}/tenant.json")"
check_body "POST tenant_access_token -> token" "mock-tenant-token" POST /open-apis/auth/v3/tenant_access_token/internal "${tmp}/tenant.json"

check_status "GET wiki nodes" "200" "$(status GET /open-apis/wiki/v2/spaces/space-1/nodes)"
check_body "GET wiki nodes -> docx node" "doc-1" GET /open-apis/wiki/v2/spaces/space-1/nodes

check_status "GET docx raw_content" "200" "$(status GET /open-apis/docx/v1/documents/doc-1/raw_content)"
check_body "GET docx raw_content -> content" "ready mechanism" GET /open-apis/docx/v1/documents/doc-1/raw_content

printf '%s\n' ''
if [[ "${failures}" -eq 0 ]]; then
  printf '%s\n' 'All mock-provider-server tests PASSED.'
  exit 0
fi
printf '%s\n' "${failures} test(s) FAILED."
exit 1