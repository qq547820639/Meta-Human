#!/usr/bin/env bash

set -euo pipefail

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  cat <<'EOF'
Usage: scripts/smoke-providers.sh

Reports which real provider smoke paths are currently available by probing
them safely (bounded timeouts, no destructive actions, loopback bypasses any
HTTP proxy):

  - local OpenAI-compatible service on 127.0.0.1:11434 (or VOXSTUDIO_LOCAL_BASE_URL)
  - remote GPU provider via VOXSTUDIO_REMOTE_BASE_URL (+ VOXSTUDIO_REMOTE_API_KEY)
  - Feishu knowledge via VOXSTUDIO_FEISHU_APP_ID / APP_SECRET / SPACE_ID
  - Apple release via Developer ID identity + notarization credentials

Each item is reported as PASS | FAIL | UNVERIFIED with a one-line actionable
fix. Exit code 0 only when at least one provider path is genuinely available;
a run where every provider is UNVERIFIED (missing credentials) also exits
nonzero because there is no real provider available.

Result codes:
  PASS        a real, reachable provider was verified
  FAIL        a provider is configured but the probe failed (or is misconfigured)
  UNVERIFIED  the provider is not configured (credentials/base URL missing)
EOF
  exit 0
fi

npass=0
nfail=0
nunver=0

report() {
  local status="$1" label="$2" fix="$3"
  printf '%-11s %s\n' "${status}" "${label}"
  printf '            fix: %s\n' "${fix}"
  case "${status}" in
    PASS) npass=$((npass + 1)) ;;
    FAIL) nfail=$((nfail + 1)) ;;
    UNVERIFIED) nunver=$((nunver + 1)) ;;
  esac
}

# Bounded, proxy-bypassing HTTP probe. Sets globals:
#   CURL_RC   curl exit code (0 only for HTTP 2xx thanks to --fail-with-body)
#   HTTP_CODE the HTTP status code captured via --write-out %{http_code}
#   PROBE_ERR curl stderr (only populated on curl-level errors)
# Writes the response body to the given out_file.
probe_http() {
  local url="$1" max_time="$2" out_file="$3" err_file
  err_file="$(mktemp)"
  CURL_RC=0
  HTTP_CODE=0
  PROBE_ERR=""
  if ! command -v curl >/dev/null 2>&1; then
    CURL_RC=127
    HTTP_CODE=000
    PROBE_ERR="curl not installed"
    rm -f "${err_file}"
    return 0
  fi
  # shellcheck disable=SC2086
  HTTP_CODE="$(curl --noproxy '*' --silent --show-error --fail-with-body \
    --max-time "${max_time}" --write-out '%{http_code}' \
    --output "${out_file}" "${url}" 2>"${err_file}")" || CURL_RC=$?
  PROBE_ERR="$(tr '\n' ' ' <"${err_file}")"
  rm -f "${err_file}"
}

# Validate a local /api/tags response: must be non-empty, non-HTML, parse as
# JSON, and describe a non-empty model list. Accepts Ollama's {"models":[...]},
# LM Studio's {"data":[...]}, or a bare JSON array of model objects.
validate_local_json() {
  local file="$1"
  python3 - "${file}" <<'PY'
import sys, json
path = sys.argv[1]
try:
    with open(path, encoding="utf-8", errors="replace") as fh:
        raw = fh.read().strip()
except OSError:
    sys.exit(2)
if not raw:
    sys.exit(3)            # empty body
low = raw[:256].lstrip().lower()
if low.startswith("<") or "<html" in low:
    sys.exit(9)            # HTML / proxy error page
try:
    data = json.loads(raw)
except Exception:
    sys.exit(4)            # not JSON
models = None
if isinstance(data, list):
    models = data
elif isinstance(data, dict):
    if isinstance(data.get("models"), list):
        models = data["models"]
    elif isinstance(data.get("data"), list):
        models = data["data"]
if models is None:
    sys.exit(5)            # not a model-list payload
if not models:
    sys.exit(6)            # empty model list
for model in models:
    if not isinstance(model, dict):
        sys.exit(7)        # bad model entry
    if not any(k in model for k in ("name", "id", "model")):
        sys.exit(8)        # model entry lacks an identifier
print("ok")
PY
}

# Validate "any valid JSON" (used for remote /health probe).
validate_any_json() {
  python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$1" 2>/dev/null
}

check_local() {
  if ! command -v curl >/dev/null 2>&1; then
    report FAIL "local OpenAI-compatible service" \
      "curl is not installed; install curl to probe the local provider"
    return
  fi
  local base="${VOXSTUDIO_LOCAL_BASE_URL:-http://127.0.0.1:11434}"
  base="${base%/}"
  local url="${base}/api/tags"
  local body
  body="$(mktemp)"
  probe_http "${url}" 3 "${body}"
  local rc="${CURL_RC}" code="${HTTP_CODE}"

  if [[ "${rc}" -eq 0 ]]; then
    if validate_local_json "${body}"; then
      report PASS "local OpenAI-compatible service is responding (HTTP ${code}, JSON OK)" \
        "no action needed"
    else
      report FAIL "local OpenAI-compatible service returned an invalid response (HTTP ${code})" \
        "the service at ${url} must return a valid non-empty JSON model list; start Ollama/LM Studio or set VOXSTUDIO_LOCAL_BASE_URL"
    fi
    rm -f "${body}"
    return
  fi

  case "${rc}" in
    6)
      report FAIL "local OpenAI-compatible service: DNS resolution failed" \
        "cannot resolve ${base}; start Ollama/LM Studio or set VOXSTUDIO_LOCAL_BASE_URL";;
    7)
      report FAIL "local OpenAI-compatible service: connection refused on ${base}" \
        "start Ollama or LM Studio, or set VOXSTUDIO_LOCAL_BASE_URL";;
    28)
      report FAIL "local OpenAI-compatible service: connection timed out" \
        "the service at ${base} is not responding; start Ollama/LM Studio or set VOXSTUDIO_LOCAL_BASE_URL";;
    22)
      case "${code}" in
        401|403)
          report FAIL "local OpenAI-compatible service: HTTP ${code} (auth required)" \
            "provide valid credentials or fix the service's authentication";;
        404)
          report FAIL "local OpenAI-compatible service: HTTP ${code} (endpoint not found)" \
            "make sure the service exposes ${url}, or set VOXSTUDIO_LOCAL_BASE_URL";;
        429)
          report FAIL "local OpenAI-compatible service: HTTP ${code} (rate limited)" \
            "retry later or reduce request load";;
        5*)
          report FAIL "local OpenAI-compatible service: HTTP ${code} (server/proxy error)" \
            "the upstream returned an error; check the service or your proxy configuration";;
        *)
          report FAIL "local OpenAI-compatible service: HTTP ${code}" \
            "check the service at ${base} is reachable";;
      esac;;
    *)
      report FAIL "local OpenAI-compatible service: curl error ${rc} (${PROBE_ERR})" \
        "check that the service at ${base} is reachable";;
  esac
  rm -f "${body}"
}

check_remote() {
  local base="${VOXSTUDIO_REMOTE_BASE_URL:-}"
  if [[ -z "${base}" ]]; then
    report UNVERIFIED "remote GPU provider" \
      "set VOXSTUDIO_REMOTE_BASE_URL (and VOXSTUDIO_REMOTE_API_KEY if required)"
    return
  fi
  base="${base%/}"
  if [[ -z "${VOXSTUDIO_REMOTE_API_KEY:-}" ]]; then
    report UNVERIFIED "remote GPU provider" \
      "VOXSTUDIO_REMOTE_BASE_URL is set but VOXSTUDIO_REMOTE_API_KEY is missing"
    return
  fi
  local url="${base}/health"
  local body
  body="$(mktemp)"
  probe_http "${url}" 5 "${body}"
  if [[ "${CURL_RC}" -eq 0 ]] && validate_any_json "${body}"; then
    report PASS "remote GPU provider is responding at ${base} (HTTP ${HTTP_CODE}, JSON OK)" \
      "no action needed"
  else
    report FAIL "remote GPU provider probe failed at ${url} (curl ${CURL_RC}, HTTP ${HTTP_CODE})" \
      "verify VOXSTUDIO_REMOTE_BASE_URL, VOXSTUDIO_REMOTE_API_KEY, and network access to ${base}"
  fi
  rm -f "${body}"
}

check_feishu() {
  local app_id="${VOXSTUDIO_FEISHU_APP_ID:-}"
  local app_secret="${VOXSTUDIO_FEISHU_APP_SECRET:-}"
  local space_id="${VOXSTUDIO_FEISHU_SPACE_ID:-}"
  if [[ -z "${app_id}" || -z "${app_secret}" || -z "${space_id}" ]]; then
    report UNVERIFIED "Feishu knowledge" \
      "set VOXSTUDIO_FEISHU_APP_ID, VOXSTUDIO_FEISHU_APP_SECRET, and VOXSTUDIO_FEISHU_SPACE_ID"
    return
  fi
  local base="${VOXSTUDIO_FEISHU_BASE_URL:-https://open.feishu.cn}"
  base="${base%/}"
  local url="${base}/open-apis/auth/v3/tenant_access_token/internal"
  local body payload err_file
  body="$(mktemp)"
  payload="$(mktemp)"
  err_file="$(mktemp)"
  printf '{"app_id":"%s","app_secret":"%s"}' "${app_id}" "${app_secret}" >"${payload}"
  CURL_RC=0; HTTP_CODE=0; PROBE_ERR=""
  HTTP_CODE="$(curl --noproxy '*' --silent --show-error --fail-with-body \
    --max-time 5 --write-out '%{http_code}' \
    -H 'Content-Type: application/json' --data @"${payload}" \
    --output "${body}" "${url}" 2>"${err_file}")" || CURL_RC=$?
  PROBE_ERR="$(tr '\n' ' ' <"${err_file}")"
  rm -f "${payload}" "${err_file}"

  if [[ "${CURL_RC}" -eq 0 ]] && python3 -c 'import sys,json; sys.exit(0) if (json.load(open(sys.argv[1])).get("code")==0 and json.load(open(sys.argv[1])).get("tenant_access_token")) else sys.exit(1)' "${body}"; then
    report PASS "Feishu knowledge OAuth token obtained (HTTP ${HTTP_CODE})" \
      "no action needed"
  elif [[ "${CURL_RC}" -eq 0 ]]; then
    report FAIL "Feishu knowledge OAuth token rejected (HTTP ${HTTP_CODE}, curl ${CURL_RC}: ${PROBE_ERR})" \
      "verify VOXSTUDIO_FEISHU_APP_ID / APP_SECRET / SPACE_ID and that the app has tenant_access_token permission"
  else
    report FAIL "Feishu knowledge probe failed at ${url} (curl ${CURL_RC}, HTTP ${HTTP_CODE}: ${PROBE_ERR})" \
      "verify VOXSTUDIO_FEISHU_BASE_URL and network access to ${base}"
  fi
  rm -f "${body}"
}

check_apple() {
  local identity_ok=0 creds_ok=0
  local count
  count="$(security find-identity -p codesigning -v 2>/dev/null | awk '/valid identities found/{print $1}')"
  if [[ -n "${count}" && "${count}" -gt 0 ]]; then
    identity_ok=1
  fi
  if [[ -n "${APPLE_TEAM_ID:-}" &&
        -n "${APPLE_NOTARY_API_KEY:-}" &&
        -n "${APPLE_NOTARY_KEY_ID:-}" &&
        -n "${APPLE_NOTARY_ISSUER:-}" ]]; then
    creds_ok=1
  fi
  if [[ "${identity_ok}" -eq 1 && "${creds_ok}" -eq 1 ]]; then
    report PASS "Apple release signing & notarization credentials" \
      "no action needed"
    return
  fi
  local missing=""
  if [[ "${identity_ok}" -eq 0 ]]; then
    missing="Developer ID signing identity (security find-identity)"
  fi
  if [[ "${creds_ok}" -eq 0 ]]; then
    if [[ -n "${missing}" ]]; then missing="${missing}; "; fi
    missing="${missing}APPLE_TEAM_ID/APPLE_NOTARY_API_KEY/APPLE_NOTARY_KEY_ID/APPLE_NOTARY_ISSUER"
  fi
  report UNVERIFIED "Apple release signing & notarization" \
    "missing: ${missing}"
}

printf '%s\n' '-- Provider smoke availability --'
check_local
check_remote
check_feishu
check_apple
printf '%s\n' ''
printf 'Summary: %d PASS, %d FAIL, %d UNVERIFIED\n' "${npass}" "${nfail}" "${nunver}"

if [[ "${npass}" -gt 0 ]]; then
  printf '%s\n' 'At least one real provider path is available.'
  exit 0
fi
if [[ "${nfail}" -gt 0 ]]; then
  printf '%s\n' 'No real provider is available (some probes failed).'
else
  printf '%s\n' 'No real provider is configured (all items UNVERIFIED due to missing credentials).'
fi
exit 1