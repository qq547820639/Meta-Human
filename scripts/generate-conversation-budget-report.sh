#!/usr/bin/env bash
#
# Generate the conversation latency-budget report and enforce the budgets in CI.
#
# Runs the desktop vitest suite for the conversation-budget modules (the pure
# unit tests + the report test). The report test computes the P95 latency of
# each natural-conversation stage from conversationBudgets.fixture.ts and writes
# output/conversation-budget-report.{md,json}. If any stage's P95 exceeds its
# budget, the report test fails and this script exits non-zero, so a latency
# regression blocks CI.
#
# Usage:
#   scripts/generate-conversation-budget-report.sh [--out DIR]
#
# Exit codes:
#   0  all budgets met (report written)
#   1  at least one budget exceeded (or a test failed)
#   2  usage / tooling error (npm or vitest missing)
#
# The default output directory is <project>/output.

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
project_root="$(cd -- "${script_dir}/.." && pwd -P)"
desktop="${project_root}/apps/desktop"
output_dir="${project_root}/output"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --out) output_dir="$2"; shift 2 ;;
    --help|-h)
      sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) printf 'error: unknown option: %s\n' "$1" >&2; exit 2 ;;
  esac
done

if ! command -v npm >/dev/null 2>&1; then
  printf 'error: npm is required\n' >&2
  exit 2
fi

mkdir -p "${output_dir}"

# Run the budget unit tests + the report test. Setting CONVERSATION_BUDGET_OUTPUT_DIR
# makes the report test emit output/conversation-budget-report.{md,json}.
cd "${desktop}"
set +e
CONVERSATION_BUDGET_OUTPUT_DIR="${output_dir}" npm test -- \
  src/features/conversation/natural/conversationBudgets.test.ts \
  src/features/conversation/natural/conversationBudgets.report.test.ts
rc=$?
set -e

echo ""
echo "===== conversation-budget-report.md ====="
cat "${output_dir}/conversation-budget-report.md"

if [[ "${rc}" -ne 0 ]]; then
  echo ""
  echo "generate-conversation-budget-report: budget violation or test failure (rc=${rc})" >&2
fi
exit "${rc}"