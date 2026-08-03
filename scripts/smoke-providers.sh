#!/usr/bin/env bash

set -euo pipefail

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  cat <<'EOF'
Usage: scripts/smoke-providers.sh

Reports which real provider smoke paths are currently available:

  - local OpenAI-compatible service on 127.0.0.1:11434
  - remote GPU provider via VOXSTUDIO_REMOTE_BASE_URL
  - Feishu knowledge via VOXSTUDIO_FEISHU_ACCESS_TOKEN and SPACE_ID
  - Apple release via APPLE_TEAM_ID and notarization credentials

Exit code 0 only when at least one provider path is available.
EOF
  exit 0
fi

available=0

check_local() {
  if command -v curl >/dev/null 2>&1 &&
    curl -sS --max-time 2 http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
    printf 'OK    local OpenAI-compatible service is responding\n'
    available=$((available + 1))
  else
    printf 'FAIL  local OpenAI-compatible service is not responding on 127.0.0.1:11434\n'
  fi
}

check_remote() {
  if [[ -n "${VOXSTUDIO_REMOTE_BASE_URL:-}" ]]; then
    printf 'OK    remote GPU provider is configured\n'
    available=$((available + 1))
  else
    printf 'FAIL  VOXSTUDIO_REMOTE_BASE_URL is not set\n'
  fi
}

check_feishu() {
  if [[ -n "${VOXSTUDIO_FEISHU_ACCESS_TOKEN:-}" &&
        -n "${VOXSTUDIO_FEISHU_SPACE_ID:-}" ]]; then
    printf 'OK    Feishu knowledge is configured\n'
    available=$((available + 1))
  else
    printf 'FAIL  Feishu access token and space id are not both set\n'
  fi
}

check_apple() {
  if [[ -n "${APPLE_TEAM_ID:-}" &&
        -n "${APPLE_NOTARY_API_KEY:-}" &&
        -n "${APPLE_NOTARY_KEY_ID:-}" &&
        -n "${APPLE_NOTARY_ISSUER:-}" ]]; then
    printf 'OK    Apple release credentials are configured\n'
    available=$((available + 1))
  else
    printf 'FAIL  Apple release credentials are not configured\n'
  fi
}

printf '%s\n' '-- Provider smoke availability --'
check_local
check_remote
check_feishu
check_apple

if [[ "${available}" -eq 0 ]]; then
  printf '%s\n' 'No provider smoke path is available.'
  exit 1
fi
printf '%s\n' 'At least one provider smoke path is available.'
