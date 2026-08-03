#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
project_root="$(cd -- "${script_dir}/.." && pwd -P)"
output_dir="${project_root}/output"
output_path="${output_dir}/release-readiness.md"

mkdir -p "${output_dir}"

{
  printf '# Release Readiness\n\n'
  printf 'Generated: %s\n\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '```text\n'
  "${script_dir}/verify-release-readiness.sh" 2>&1 || true
  printf '```\n'
} > "${output_path}"

cat "${output_path}"
