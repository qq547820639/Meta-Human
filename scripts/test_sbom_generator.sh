#!/usr/bin/env bash
#
# test_sbom_generator.sh
#
# Regression test for scripts/generate-sbom.sh. Runs the generator against the
# real committed lockfiles into a temp output dir, then asserts the emitted
# SBOM is a well-formed CycloneDX 1.5 document covering all three stacks.
#
# The assertions are deliberately strict and are NOT weakened:
#   - the required lockfiles must exist (the generator fails loudly otherwise)
#   - the JSON must parse and be valid CycloneDX (bomFormat / specVersion /
#     serialNumber / metadata.component / components[])
#   - every stack (python / rust / javascript) must contribute >= 1 component
#   - the metadata version must match tauri.conf.json, and the git commit
#     property must be present
#
# Usage:
#   scripts/test_sbom_generator.sh
#
# Exit codes:
#   0  all assertions passed
#   1  at least one assertion failed (or a required lockfile is missing)

set -uo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
project_root="$(cd -- "${script_dir}/.." && pwd -P)"
desktop_project="${project_root}/apps/desktop"

tmp="$(mktemp -d "${TMPDIR:-/tmp}/sbom-test.XXXXXX")"
trap 'rm -rf "${tmp}"' EXIT

pass=0
fail=0

check() {
  local name="$1"
  local cond="$2"
  if [[ "$cond" == "ok" ]]; then
    printf 'ok   - %s\n' "${name}"
    pass=$((pass + 1))
  else
    printf 'FAIL - %s\n' "${name}"
    fail=$((fail + 1))
  fi
}

# Required lockfiles must be present (the generator must fail loudly otherwise).
uv_lock="${project_root}/apps/sidecar/uv.lock"
cargo_lock="${desktop_project}/src-tauri/Cargo.lock"
pnpm_lock="${project_root}/pnpm-lock.yaml"
[[ -f "${pnpm_lock}" ]] || pnpm_lock="${desktop_project}/pnpm-lock.yaml"

for lf in "${uv_lock}" "${cargo_lock}" "${pnpm_lock}"; do
  if [[ ! -f "${lf}" ]]; then
    printf 'FAIL - required lockfile missing: %s\n' "${lf}"
    exit 1
  fi
done
printf 'ok   - required lockfiles present (uv.lock / Cargo.lock / pnpm-lock.yaml)\n'
pass=$((pass + 1))

# Run the generator against the real lockfiles into the temp output dir.
if ! "${script_dir}/generate-sbom.sh" --output-dir "${tmp}" >/dev/null 2>&1; then
  printf 'FAIL - generate-sbom.sh did not exit 0 against the real lockfiles\n'
  exit 1
fi
printf 'ok   - generate-sbom.sh exited 0 against the real lockfiles\n'
pass=$((pass + 1))

sbom="${tmp}/sbom.cyclonedx.json"
if [[ ! -f "${sbom}" ]]; then
  printf 'FAIL - SBOM file not produced: %s\n' "${sbom}"
  exit 1
fi

# Validate the JSON and CycloneDX structure + per-stack component presence.
validate_py="${tmp}/validate.py"
cat > "${validate_py}" <<'PY'
import json, os, sys
path = sys.argv[1]
try:
    with open(path, encoding="utf-8") as fh:
        bom = json.load(fh)
except Exception as exc:
    print(f"NOT_JSON:{exc}")
    sys.exit(1)

errors = []
if bom.get("bomFormat") != "CycloneDX":
    errors.append("bomFormat != CycloneDX")
if bom.get("specVersion") != "1.5":
    errors.append("specVersion != 1.5")
if not str(bom.get("serialNumber", "")).startswith("urn:uuid:"):
    errors.append("serialNumber not a urn:uuid")
if not isinstance(bom.get("components"), list) or not bom["components"]:
    errors.append("components missing/empty")
meta = bom.get("metadata", {})
mcomp = meta.get("component", {})
if mcomp.get("name") != "VoxStudio":
    errors.append("metadata.component.name != VoxStudio")
props = {p.get("name"): p.get("value") for p in meta.get("properties", [])}
if not props.get("git:commit"):
    errors.append("metadata git:commit property missing/empty")

groups = {}
for c in bom["components"]:
    groups[c.get("group")] = groups.get(c.get("group"), 0) + 1
for stack in ("python", "rust", "javascript"):
    if groups.get(stack, 0) < 1:
        errors.append(f"no components for stack: {stack}")

if errors:
    print("ERRORS:" + ";".join(errors))
    sys.exit(1)
print("VALID")
PY

if python3 "${validate_py}" "${sbom}"; then
  printf 'ok   - SBOM is valid CycloneDX 1.5 with python/rust/javascript components\n'
  pass=$((pass + 1))
else
  printf 'FAIL - SBOM validation failed (see above)\n'
  exit 1
fi

# Version must match tauri.conf.json.
expected_version="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("version",""))' \
  "${desktop_project}/src-tauri/tauri.conf.json" 2>/dev/null || true)"
sbom_version="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["metadata"]["component"].get("version",""))' \
  "${sbom}" 2>/dev/null || true)"
if [[ -n "${expected_version}" && "${expected_version}" == "${sbom_version}" ]]; then
  printf 'ok   - SBOM version %s matches tauri.conf.json\n' "${sbom_version}"
  pass=$((pass + 1))
else
  printf 'FAIL - SBOM version %q does not match tauri.conf.json %q\n' "${sbom_version}" "${expected_version:-<unset>}"
  fail=$((fail + 1))
fi

printf '\n%d passed, %d failed\n' "${pass}" "${fail}"
if [[ "${fail}" -gt 0 ]]; then
  exit 1
fi
exit 0