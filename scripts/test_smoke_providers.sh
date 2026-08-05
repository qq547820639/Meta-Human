#!/usr/bin/env bash

# Automated tests for scripts/smoke-providers.sh.
#
# Uses bash + python3 + curl only (no new runtime dependencies). Stands up
# throwaway local HTTP servers to simulate proxy responses, malformed JSON,
# timeouts, connection failures, and healthy providers. All temp files and
# processes are cleaned up on exit.

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
smoke="${script_dir}/smoke-providers.sh"

tmp="$(mktemp -d)"
rm -f "${tmp}/pids"
failures=0

cleanup() {
  local pid
  while read -r pid; do
    [[ -n "${pid}" ]] && kill "${pid}" 2>/dev/null || true
  done <"${tmp}/pids" 2>/dev/null || true
  rm -rf "${tmp}"
}
trap cleanup EXIT

# --- mock HTTP server ------------------------------------------------------
# Reads a JSON "spec" from $MOCK_SPEC: {"status":N,"body":"...","ctype":"...","delay":N}
cat >"${tmp}/mock.py" <<'PY'
import http.server, json, os, sys, time
spec = json.loads(os.environ["MOCK_SPEC"])

class H(http.server.BaseHTTPRequestHandler):
    def _respond(self):
        time.sleep(spec.get("delay", 0))
        body = spec.get("body", "").encode()
        self.send_response(spec.get("status", 200))
        self.send_header("Content-Type", spec.get("ctype", "application/json"))
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    do_GET = _respond
    do_POST = _respond
    def log_message(self, *args):
        pass

if __name__ == "__main__":
    port = int(sys.argv[1])
    http.server.ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
PY

wait_up() {
  local port="$1" rc tries
  for _ in $(seq 1 50); do
    rc=0
    curl --noproxy '*' -s --max-time 8 -o /dev/null "http://127.0.0.1:${port}/" 2>/dev/null || rc=$?
    if [[ "${rc}" -ne 7 && "${rc}" -ne 28 ]]; then
      return 0
    fi
    sleep 0.1
  done
  return 1
}

start_mock() {
  local spec="$1" port
  port="$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')"
  MOCK_SPEC="${spec}" python3 "${tmp}/mock.py" "${port}" >/dev/null 2>&1 &
  echo "$!" >>"${tmp}/pids"
  wait_up "${port}"
  printf '%s' "${port}"
}

# Run the smoke script with a controlled environment and return the local line.
run_local() {
  local base_url="$1" proxy="${2:-}"
  local -a envs=(
    "VOXSTUDIO_LOCAL_BASE_URL=${base_url}"
    "VOXSTUDIO_REMOTE_BASE_URL="
    "VOXSTUDIO_REMOTE_API_KEY="
    "VOXSTUDIO_FEISHU_APP_ID="
    "VOXSTUDIO_FEISHU_APP_SECRET="
    "VOXSTUDIO_FEISHU_SPACE_ID="
    "APPLE_TEAM_ID="
    "APPLE_NOTARY_API_KEY="
    "APPLE_NOTARY_KEY_ID="
    "APPLE_NOTARY_ISSUER="
  )
  if [[ -n "${proxy}" ]]; then
    envs+=(HTTP_PROXY="${proxy}" HTTPS_PROXY="${proxy}" ALL_PROXY="${proxy}")
  else
    envs+=(HTTP_PROXY= HTTPS_PROXY= ALL_PROXY=)
  fi
  local out
  out="$(env "${envs[@]}" "${smoke}" 2>&1 || true)"
  printf '%s\n' "${out}" | grep -E '^(PASS|FAIL|UNVERIFIED) +local' | head -n1
}

check() {
  local name="$1" expected="$2" actual="$3"
  if [[ "${actual}" == *"${expected}"* ]]; then
    printf 'ok    %s (got: %s)\n' "${name}" "${actual}"
  else
    printf 'FAIL  %s (expected: %s, got: %s)\n' "${name}" "${expected}" "${actual}"
    failures=$((failures + 1))
  fi
}

# --- 1. proxy returning 502 (old curl would exit 0) must be FAIL ----------
port="$(start_mock '{"status":502,"body":"502 Bad Gateway from proxy"}')"
line="$(run_local "http://127.0.0.1:${port}" "http://127.0.0.1:${port}")"
check "proxy 502 is FAIL, not OK" "FAIL" "${line}"
check "proxy 502 reports 502" "502" "${line}"

# --- 2. HTTP 200 but not JSON -> FAIL -------------------------------------
port="$(start_mock '{"status":200,"body":"definitely not-json {{"}')"
line="$(run_local "http://127.0.0.1:${port}")"
check "HTTP 200 non-JSON is FAIL" "FAIL" "${line}"

# --- 3. timeout -> FAIL (distinct message) --------------------------------
port="$(start_mock '{"status":200,"body":"{}","delay":6}')"
line="$(run_local "http://127.0.0.1:${port}")"
check "timeout is FAIL" "FAIL" "${line}"
check "timeout message distinguishes timeout" "timed out" "${line}"

# --- 4. connection refused -> FAIL (distinct message) ---------------------
line="$(run_local "http://127.0.0.1:1")"
check "connection refused is FAIL" "FAIL" "${line}"
check "connection refused message" "connection refused" "${line}"

# --- 5. HTTP error statuses -> FAIL ---------------------------------------
for code in 401 403 404 429 500; do
  port="$(start_mock "{\"status\":${code},\"body\":\"err ${code}\"}")"
  line="$(run_local "http://127.0.0.1:${port}")"
  check "HTTP ${code} is FAIL" "FAIL" "${line}"
  check "HTTP ${code} reported" "${code}" "${line}"
done

# --- 6. valid provider responses -> PASS (object, array, html-guard) ------
port="$(start_mock '{"status":200,"body":"{\"models\":[{\"name\":\"test-model\"}]}"}')"
line="$(run_local "http://127.0.0.1:${port}")"
check "Ollama-style tags object is PASS" "PASS" "${line}"

port="$(start_mock '{"status":200,"body":"[{\"name\":\"test-model\"}]"}')"
line="$(run_local "http://127.0.0.1:${port}")"
check "bare JSON array is PASS" "PASS" "${line}"

port="$(start_mock '{"status":200,"body":"{\"models\":[]}"}')"
line="$(run_local "http://127.0.0.1:${port}")"
check "empty model list is FAIL" "FAIL" "${line}"

port="$(start_mock '{"status":200,"body":"<html>proxy error</html>","ctype":"text/html"}')"
line="$(run_local "http://127.0.0.1:${port}")"
check "HTML proxy error page is FAIL" "FAIL" "${line}"

# --- 7. proxy env set but loopback must bypass proxy -> PASS --------------
good="$(start_mock '{"status":200,"body":"{\"models\":[{\"name\":\"test-model\"}]}"}')"
bad="$(start_mock '{"status":502,"body":"502"}')"
line="$(run_local "http://127.0.0.1:${good}" "http://127.0.0.1:${bad}")"
check "loopback bypasses proxy (--noproxy) is PASS" "PASS" "${line}"

# --- 8. DNS resolution failure -> FAIL ------------------------------------
line="$(run_local "http://no-such-host-${RANDOM}.invalid")"
check "DNS failure is FAIL" "FAIL" "${line}"

# --- 9. exit code nonzero when no provider available ----------------------
set +e
env VOXSTUDIO_LOCAL_BASE_URL="http://127.0.0.1:1" \
  VOXSTUDIO_REMOTE_BASE_URL= VOXSTUDIO_REMOTE_API_KEY= \
  VOXSTUDIO_FEISHU_APP_ID= VOXSTUDIO_FEISHU_APP_SECRET= VOXSTUDIO_FEISHU_SPACE_ID= \
  APPLE_TEAM_ID= APPLE_NOTARY_API_KEY= APPLE_NOTARY_KEY_ID= APPLE_NOTARY_ISSUER= \
  HTTP_PROXY= HTTPS_PROXY= ALL_PROXY= "${smoke}" >/dev/null 2>&1
rc=$?
set -e
check "nonzero exit when no real provider" "1" "${rc}"

# --- 10. exit code zero when a real local provider is available -----------
port="$(start_mock '{"status":200,"body":"{\"models\":[{\"name\":\"test-model\"}]}"}')"
set +e
env VOXSTUDIO_LOCAL_BASE_URL="http://127.0.0.1:${port}" \
  VOXSTUDIO_REMOTE_BASE_URL= VOXSTUDIO_REMOTE_API_KEY= \
  VOXSTUDIO_FEISHU_APP_ID= VOXSTUDIO_FEISHU_APP_SECRET= VOXSTUDIO_FEISHU_SPACE_ID= \
  APPLE_TEAM_ID= APPLE_NOTARY_API_KEY= APPLE_NOTARY_KEY_ID= APPLE_NOTARY_ISSUER= \
  HTTP_PROXY= HTTPS_PROXY= ALL_PROXY= "${smoke}" >/dev/null 2>&1
rc=$?
set -e
check "zero exit when a real provider is available" "0" "${rc}"

# --- 11. missing creds are UNVERIFIED (not FAIL) + summary shown ----------
out="$(env VOXSTUDIO_LOCAL_BASE_URL="http://127.0.0.1:1" \
  VOXSTUDIO_REMOTE_BASE_URL= VOXSTUDIO_REMOTE_API_KEY= \
  VOXSTUDIO_FEISHU_APP_ID= VOXSTUDIO_FEISHU_APP_SECRET= VOXSTUDIO_FEISHU_SPACE_ID= \
  APPLE_TEAM_ID= APPLE_NOTARY_API_KEY= APPLE_NOTARY_KEY_ID= APPLE_NOTARY_ISSUER= \
  HTTP_PROXY= HTTPS_PROXY= ALL_PROXY= "${smoke}" 2>&1 || true)"
check "remote without creds is UNVERIFIED" "UNVERIFIED  remote GPU provider" "${out}"
check "feishu without creds is UNVERIFIED" "UNVERIFIED  Feishu knowledge" "${out}"
check "apple without creds is UNVERIFIED" "UNVERIFIED  Apple release" "${out}"
check "summary shows 0 PASS, 1 FAIL, 3 UNVERIFIED" "Summary: 0 PASS, 1 FAIL, 3 UNVERIFIED" "${out}"

printf '%s\n' ''
if [[ "${failures}" -eq 0 ]]; then
  printf '%s\n' 'All smoke-providers tests PASSED.'
  exit 0
fi
printf '%s\n' "${failures} test(s) FAILED."
exit 1