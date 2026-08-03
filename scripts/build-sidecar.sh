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

command -v rustc >/dev/null 2>&1 || {
  printf 'error: rustc is required to determine the host triple\n' >&2
  exit 1
}
command -v uv >/dev/null 2>&1 || {
  printf 'error: uv is required to build the Sidecar executable\n' >&2
  exit 1
}

host_triple="$(rustc -vV | awk '/^host:/ { print $2 }')"
case "${host_triple}" in
  '' | *[!A-Za-z0-9._-]*)
    printf 'error: rustc returned an invalid host triple\n' >&2
    exit 1
    ;;
esac

executable_suffix=''
case "${host_triple}" in
  *-windows-*) executable_suffix='.exe' ;;
esac

output_name="digital-human-sidecar-${host_triple}${executable_suffix}"
output_path="${destination_dir}/${output_name}"
executable_name='digital-human-sidecar'
executable_output="${executable_name}${executable_suffix}"

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

temporary_root="$(mktemp -d "${TMPDIR:-/tmp}/voxstudio-sidecar-build.XXXXXX")"
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

(
  cd "${source_root}"
  uv run \
    --project "${sidecar_project}" \
    --with nuitka \
    --with zstandard \
    nuitka \
    --onefile \
    --assume-yes-for-downloads \
    --disable-cache=ccache \
    --output-dir="${temporary_root}/dist" \
    --output-filename="${executable_output}" \
    --include-data-dir="${migrations_source}=voxstudio_core/persistence/migrations" \
    --include-data-dir="${assets_source}=voxstudio_core/assets" \
    "voxstudio_core/main.py"
)

built_output="${temporary_root}/dist/${executable_output}"
if [[ ! -f "${built_output}" ]]; then
  printf 'error: Nuitka did not produce the expected executable\n' >&2
  exit 1
fi

mkdir -p "${destination_dir}"
staged_output="$(mktemp "${destination_dir}/.${output_name}.tmp.XXXXXX")"
install -m 755 "${built_output}" "${staged_output}"
mv -f "${staged_output}" "${output_path}"
staged_output=''

printf 'Built Sidecar: %s\n' "${output_path}"
printf 'Host triple: %s\n' "${host_triple}"
