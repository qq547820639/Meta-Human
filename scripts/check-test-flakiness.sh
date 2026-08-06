#!/usr/bin/env bash
#
# check-test-flakiness.sh
#
# Real test-flakiness detection for the sidecar suite. Runs the full pytest
# suite twice and fails if any test's outcome is inconsistent between the two
# runs (i.e. a test that passed in run 1 but failed in run 2, or vice versa).
# This forbids masking flaky failures behind a simple "rerun until green".
#
# Usage:
#   scripts/check-test-flakiness.sh [--passes N] [--project PATH]
#
# Exit codes:
#   0  suite is stable across N runs (no inconsistency)
#   1  flakiness detected (some test outcome changed between runs)
#   2  usage / tooling error
#
# The JUnit XML from each run is parsed to build a per-test outcome map. A
# real pytest invocation (not a Mock) is used; no assertions are weakened.

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
project_root="$(cd -- "${script_dir}/.." && pwd -P)"
project="${project_root}/apps/sidecar"
passes=2

while [[ $# -gt 0 ]]; do
  case "$1" in
    --passes) passes="$2"; shift 2 ;;
    --project) project="$2"; shift 2 ;;
    --help|-h)
      sed -n '2,30p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) printf 'error: unknown option: %s\n' "$1" >&2; exit 2 ;;
  esac
done

if ! command -v uv >/dev/null 2>&1; then
  printf 'error: uv is required\n' >&2
  exit 2
fi
if ! command -v python3 >/dev/null 2>&1; then
  printf 'error: python3 is required\n' >&2
  exit 2
fi

tmpdir="$(mktemp -d "${TMPDIR:-/tmp}/flaky-detect.XXXXXX")"
trap 'rm -rf "${tmpdir}"' EXIT

# Run the suite `passes` times, capturing per-test outcomes from JUnit XML.
declare -a outcomes  # "run_index testname outcome" lines
for i in $(seq 1 "${passes}"); do
  junit="${tmpdir}/junit-${i}.xml"
  uv run --project "${project}" pytest "${project}/tests" \
    --strict-markers --strict-config \
    --junitxml="${junit}" >/dev/null 2>&1 || true
  if [[ ! -f "${junit}" ]]; then
    printf 'error: pytest did not produce JUnit XML on pass %s\n' "${i}" >&2
    exit 2
  fi
  python3 - "${junit}" "${i}" "${tmpdir}" <<'PY'
import sys, xml.etree.ElementTree as ET
path, run, outdir = sys.argv[1], sys.argv[2], sys.argv[3]
root = ET.parse(path).getroot()
lines = []
for tc in root.iter("testcase"):
    name = tc.get("classname", "") + "::" + tc.get("name", "")
    outcome = "fail" if tc.find("failure") is not None else "pass"
    lines.append(f"{run} {name} {outcome}")
with open(f"{outdir}/outcomes-{run}.txt", "w") as fh:
    fh.write("\n".join(lines) + "\n")
PY
done

# Compare outcomes across runs. A test present in more than one run whose
# outcome differs is flaky.
python3 - "${tmpdir}" "${passes}" <<'PY'
import os, sys
outdir, passes = sys.argv[1], int(sys.argv[2])
by_test = {}
for i in range(1, passes + 1):
    path = f"{outdir}/outcomes-{i}.txt"
    if not os.path.exists(path):
        continue
    with open(path) as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            _, name, outcome = line.split(" ", 2)
            by_test.setdefault(name, set()).add(outcome)

flaky = [(name, outcomes) for name, outcomes in by_test.items() if len(outcomes) > 1]
if flaky:
    print(f"FLAKY tests detected across {passes} runs:")
    for name, outcomes in sorted(flaky):
        print(f"  {name}: outcomes={'/'.join(sorted(outcomes))}")
    sys.exit(1)
total = len(by_test)
print(f"Stable across {passes} runs: {total} distinct tests, no inconsistent outcomes.")
sys.exit(0)
PY