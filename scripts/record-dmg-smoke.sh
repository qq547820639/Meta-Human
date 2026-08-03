#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
project_root="$(cd -- "${script_dir}/.." && pwd -P)"
output_dir="${project_root}/output"
output_path="${output_dir}/dmg-smoke.md"

mkdir -p "${output_dir}"

{
  printf '# Packaged DMG Smoke\n\n'
  printf 'Generated: %s\n\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '```text\n'
  "${script_dir}/smoke-dmg.sh" "$@" 2>&1 || true
  printf '```\n'
} > "${output_path}"

cat "${output_path}"
