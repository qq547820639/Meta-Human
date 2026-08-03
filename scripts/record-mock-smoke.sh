#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
project_root="$(cd -- "${script_dir}/.." && pwd -P)"
output_dir="${project_root}/output"
output_path="${output_dir}/mock-provider-smoke.md"
sidecar_venv="${project_root}/apps/sidecar/.venv/bin/python"

mkdir -p "${output_dir}"

{
  printf '# Mock Provider End-to-End Smoke\n\n'
  printf 'Generated: %s\n\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '```text\n'
  "${sidecar_venv}" "${script_dir}/smoke-mock-provider.py" 2>&1 || true
  printf '```\n'
} > "${output_path}"

cat "${output_path}"
