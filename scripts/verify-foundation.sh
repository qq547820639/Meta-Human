#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
project_root="$(cd -- "${script_dir}/.." && pwd -P)"
sidecar_project="${project_root}/apps/sidecar"
desktop_project="${project_root}/apps/desktop"
tauri_manifest="${desktop_project}/src-tauri/Cargo.toml"
binaries_dir="${desktop_project}/src-tauri/binaries"

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  cat <<'EOF'
Usage: scripts/verify-foundation.sh

Verifies the VoxStudio readiness vertical slice foundation:
  1. Required tools (Rust, uv, Node, pnpm) are installed.
  2. The packaged sidecar binary exists for the current host triple.
  3. All focused suites and builds pass:
       - Python: pytest (strict markers/config)
       - Frontend: vitest, tsc --noEmit, vite build
       - Rust: cargo fmt --check, clippy -D warnings, cargo test

Exit code 0 only when every check passes.
EOF
  exit 0
fi

failures=0

report() {
  local status="$1"
  local label="$2"
  if [[ "${status}" -eq 0 ]]; then
    printf 'PASS  %s\n' "${label}"
  else
    printf 'FAIL  %s\n' "${label}"
  fi
}

require_command() {
  local tool="$1"
  if ! command -v "${tool}" >/dev/null 2>&1; then
    printf 'FAIL  missing required command: %s\n' "${tool}"
    failures=$((failures + 1))
    return 1
  fi
  printf 'OK    %s: %s\n' "${tool}" "$(command -v "${tool}")"
}

run_gate() {
  local label="$1"
  shift
  if "$@"; then
    report 0 "${label}"
    return 0
  fi
  report 1 "${label}"
  failures=$((failures + 1))
  return 1
}

printf '== VoxStudio foundation verification ==\n\n'

printf '%s\n' '-- Toolchain --'
require_command rustc
require_command cargo
require_command rustfmt
require_command cargo-clippy
require_command uv
require_command node
require_command pnpm

printf '\n%s\n' '-- Sidecar package --'
host_triple="$(
  rustc -vV | awk '/^host:/ { print $2 }'
)"
if [[ -z "${host_triple}" ]]; then
  printf 'FAIL  unable to determine Rust host triple\n' >&2
  failures=$((failures + 1))
  host_triple='unknown'
fi

sidecar_binary="${binaries_dir}/digital-human-sidecar-${host_triple}"
if [[ -x "${sidecar_binary}" ]]; then
  printf 'OK    packaged sidecar: %s\n' "${sidecar_binary}"
else
  printf 'FAIL  packaged sidecar is missing or not executable: %s\n' "${sidecar_binary}"
  printf '      Build it with: scripts/build-sidecar.sh\n'
  failures=$((failures + 1))
fi

printf '\n%s\n' '-- Automated gates --'
run_gate "pytest (sidecar)" \
  uv run --project "${sidecar_project}" pytest "${sidecar_project}/tests" \
  --strict-markers --strict-config -q
run_gate "vitest (desktop)" \
  pnpm --dir "${desktop_project}" exec vitest run
run_gate "tsc --noEmit (desktop)" \
  pnpm --dir "${desktop_project}" exec tsc --noEmit
run_gate "vite build (desktop)" \
  pnpm --dir "${desktop_project}" build
run_gate "cargo fmt --check" \
  cargo fmt --manifest-path "${tauri_manifest}" -- --check
run_gate "cargo clippy -D warnings" \
  cargo clippy --manifest-path "${tauri_manifest}" \
  --all-targets --all-features -- -D warnings
run_gate "cargo test" \
  cargo test --manifest-path "${tauri_manifest}"

printf '\n'
if [[ "${failures}" -eq 0 ]]; then
  printf 'Foundation verification PASSED.\n'
  exit 0
fi
printf 'Foundation verification FAILED with %d problem(s).\n' "${failures}"
exit 1
