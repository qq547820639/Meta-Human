#!/usr/bin/env bash
#
# test_test_matrix.sh — regression tests for scripts/run-test-matrix.sh.
#
# Asserts:
#   1. the runner produces a valid JSON report,
#   2. the report contains the current commit SHA and the app version,
#   3. every mandatory near-real item (db-migration, session-pagination,
#      multi-session, multi-human) is present and not FAIL.
#
# Usage:
#   scripts/test_test_matrix.sh
#
# Exit codes:
#   0  all assertions passed
#   1  at least one assertion failed

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
project_root="$(cd -- "${script_dir}/.." && pwd -P)"
json_path="${project_root}/output/test-matrix.json"

pass=0
fail=0

check() {
  local name="$1"
  if [[ "$2" == "$3" ]]; then
    printf 'ok   - %s\n' "${name}"
    pass=$((pass + 1))
  else
    printf 'FAIL - %s (expected %q, got %q)\n' "${name}" "$2" "$3"
    fail=$((fail + 1))
  fi
}

# MSYS/macOS path handling for python3.
command -v python3 >/dev/null 2>&1 || {
  printf 'FAIL - python3 is required for this test\n'
  exit 1
}

# --- 1) valid JSON report ------------------------------------------------
if [[ ! -f "${json_path}" ]]; then
  printf 'FAIL - %s does not exist (run scripts/run-test-matrix.sh first)\n' "${json_path}"
  exit 1
fi

if python3 -c 'import json,sys;json.load(open(sys.argv[1]))' "${json_path}" >/dev/null 2>&1; then
  check 'report is valid JSON' 'yes' 'yes'
else
  check 'report is valid JSON' 'yes' 'no'
fi

# --- 2) commit SHA and version present -----------------------------------
commit="$(git -C "${project_root}" rev-parse HEAD)"
check 'report contains commit SHA' \
  "$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["environment"]["commit"])' "${json_path}")" \
  "${commit}"

expected_version="$(
  python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["version"])' \
    "${project_root}/apps/desktop/src-tauri/tauri.conf.json"
)"
check 'report contains app version' \
  "$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["environment"]["version"])' "${json_path}")" \
  "${expected_version}"

# --- 3) mandatory near-real items present and not FAIL -------------------
mandatory="db-migration session-pagination multi-session multi-human"
for name in ${mandatory}; do
  present="$(python3 -c "
import json,sys
r=json.load(open(sys.argv[1]))
print('yes' if any(i['name']==sys.argv[2] for i in r['items']) else 'no')
" "${json_path}" "${name}")"
  check "mandatory item ${name} present" 'yes' "${present}"

  status="$(python3 -c "
import json,sys
r=json.load(open(sys.argv[1]))
for i in r['items']:
    if i['name']==sys.argv[2]:
        print(i['status']); break
" "${json_path}" "${name}")"
  if [[ "${status}" == "FAIL" ]]; then
    check "mandatory item ${name} not FAIL" 'not-fail' 'FAIL'
  else
    check "mandatory item ${name} not FAIL" 'not-fail' 'not-fail'
  fi
done

# --- Summary -------------------------------------------------------------
printf '\n%d passed, %d failed\n' "${pass}" "${fail}"
if [[ "${fail}" -gt 0 ]]; then
  exit 1
fi
exit 0