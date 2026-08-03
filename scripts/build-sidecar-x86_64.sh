#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
project_root="$(cd -- "${script_dir}/.." && pwd -P)"
sidecar_project="${project_root}/apps/sidecar"
source_root="${sidecar_project}/src"
entrypoint="${source_root}/voxstudio_core/main.py"
migrations_source="${source_root}/voxstudio_core/persistence/migrations"
assets_source="${source_root}/voxstudio_core/assets"
destination_dir="${project_root}/apps/desktop/src-tauri/binaries"

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  cat <<'EOF'
Usage: VOXSTUDIO_X86_PYTHON=/path/to/x86_64/python3.12 scripts/build-sidecar-x86_64.sh

Builds the sidecar for x86_64-apple-darwin with Nuitka.

Required environment:
  VOXSTUDIO_X86_PYTHON   x86_64 Python 3.12 interpreter (Rosetta or Intel Mac)
  VOXSTUDIO_X86_TOOLCHAIN Optional PATH prefix containing x86-compatible tool wrappers

The final binary is written to:
  apps/desktop/src-tauri/binaries/digital-human-sidecar-x86_64-apple-darwin
EOF
  exit 0
fi

command -v uv >/dev/null 2>&1 || {
  printf 'error: uv is required to build the Sidecar executable\n' >&2
  exit 1
}

x86_python="${VOXSTUDIO_X86_PYTHON:-}"
if [[ -z "${x86_python}" ]]; then
  printf 'error: VOXSTUDIO_X86_PYTHON is required\n' >&2
  exit 2
fi
if [[ ! -x "${x86_python}" ]]; then
  printf 'error: VOXSTUDIO_X86_PYTHON is not executable: %s\n' "${x86_python}" >&2
  exit 2
fi

if ! arch -x86_64 "${x86_python}" -c \
  'import platform; raise SystemExit(0 if platform.machine() == "x86_64" else 1)' \
  >/dev/null 2>&1; then
  printf 'error: VOXSTUDIO_X86_PYTHON is not an x86_64 Python interpreter\n' >&2
  exit 2
fi

for required_path in \
  "${sidecar_project}/pyproject.toml" \
  "${entrypoint}" \
  "${migrations_source}" \
  "${assets_source}/readiness/stt_sample.wav"
do
  if [[ ! -e "${required_path}" ]]; then
    printf 'error: required Sidecar source is missing: %s\n' "${required_path}" >&2
    exit 1
  fi
done

temporary_root="$(mktemp -d "${TMPDIR:-/tmp}/voxstudio-sidecar-x86-build.XXXXXX")"
venv="${temporary_root}/venv"
staged_output=''

cleanup() {
  if [[ -n "${staged_output}" && -e "${staged_output}" ]]; then
    rm -f "${staged_output}"
  fi
  if [[ -n "${temporary_root}" && -d "${temporary_root}" ]]; then
    rm -rf "${temporary_root}"
  fi
}

trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

printf 'Preparing x86_64 Sidecar virtual environment...\n'
UV_PROJECT_ENVIRONMENT="${venv}" \
  uv sync --project "${sidecar_project}" --python "${x86_python}" >/dev/null
uv pip install --python "${venv}/bin/python" nuitka zstandard >/dev/null

(
  cd "${source_root}"
  PATH="${VOXSTUDIO_X86_TOOLCHAIN:+${VOXSTUDIO_X86_TOOLCHAIN}:${PATH}}" \
    arch -x86_64 "${venv}/bin/python" -m nuitka \
    --onefile \
    --assume-yes-for-downloads \
    --disable-cache=ccache \
    --output-dir="${temporary_root}/dist" \
    --output-filename="digital-human-sidecar-x86_64" \
    --include-data-dir="${migrations_source}=voxstudio_core/persistence/migrations" \
    --include-data-dir="${assets_source}=voxstudio_core/assets" \
    "voxstudio_core/main.py"
)

built_output="${temporary_root}/dist/digital-human-sidecar-x86_64"
if [[ ! -f "${built_output}" ]]; then
  printf 'error: Nuitka did not produce the expected x86_64 executable\n' >&2
  exit 1
fi

output_path="${destination_dir}/digital-human-sidecar-x86_64-apple-darwin"
mkdir -p "${destination_dir}"
staged_output="$(mktemp "${destination_dir}/.${output_path##*/}.tmp.XXXXXX")"
install -m 755 "${built_output}" "${staged_output}"
mv -f "${staged_output}" "${output_path}"
staged_output=''

printf 'Built x86_64 Sidecar: %s\n' "${output_path}"
