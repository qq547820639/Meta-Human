#!/usr/bin/env bash
#
# Run the real provider acceptance executor and write the machine-readable JSON
# plus human-readable Markdown reports to output/.
#
# Usage:
#   scripts/record-provider-acceptance.sh [--strict]
#
# --strict  treat any UNVERIFIED or FAIL item as a non-zero exit (the executor
#           itself exits non-zero under --strict when not everything PASSes).
#
# The executor is run through the sidecar's uv environment so it can import
# voxstudio_core. Missing credentials are reported as UNVERIFIED (never PASS);
# a local OpenAI-compatible service that is absent is reported as FAIL.

set -euo pipefail

strict=0
for arg in "$@"; do
  case "${arg}" in
    --strict) strict=1 ;;
    --help|-h)
      sed -n '2,20p' "$0"
      exit 0
      ;;
    *)
      echo "unknown argument: ${arg}" >&2
      echo "usage: $(basename "$0") [--strict]" >&2
      exit 2
      ;;
  esac
done

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
project_root="$(cd -- "${script_dir}/.." && pwd -P)"
output_dir="${project_root}/output"
json_path="${output_dir}/provider-acceptance.json"
md_path="${output_dir}/provider-acceptance.md"

mkdir -p "${output_dir}"

set +e
if [[ "${strict}" -eq 1 ]]; then
  (cd "${project_root}" && uv run --project apps/sidecar python \
    scripts/accept-providers/accept_providers.py \
    --json "${json_path}" --md "${md_path}" --strict)
else
  (cd "${project_root}" && uv run --project apps/sidecar python \
    scripts/accept-providers/accept_providers.py \
    --json "${json_path}" --md "${md_path}")
fi
rc=$?
set -e

echo ""
echo "===== provider-acceptance.md ====="
sed -n '1,80p' "${md_path}"
echo ""
echo "===== provider-acceptance.md (tail) ====="
tail -n 30 "${md_path}"

if [[ "${rc}" -ne 0 ]]; then
  echo ""
  echo "record-provider-acceptance: executor exited ${rc}" >&2
fi
exit "${rc}"