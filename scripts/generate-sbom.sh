#!/usr/bin/env bash
#
# generate-sbom.sh
#
# Generates a CycloneDX 1.5 JSON SBOM for a VoxStudio release covering the
# three stacks — the Python sidecar, the Rust shell, and the frontend (JS/npm)
# — by parsing the existing, committed lockfiles. It performs no network
# installs, is fully offline and idempotent, and emits its result to
# <project>/output/sbom.cyclonedx.json.
#
# Lockfiles parsed:
#   Python : apps/sidecar/uv.lock            (TOML, [[package]] -> name/version)
#   Rust   : apps/desktop/src-tauri/Cargo.lock (TOML, [[package]] -> name/version/source)
#   Frontend: pnpm-lock.yaml (or apps/desktop/pnpm-lock.yaml) package keys
#
# Fail loudly (exit non-zero) if a required lockfile is missing or a stack
# yields zero components. The SBOM is a separate artifact from the SHA256 /
# provenance outputs of scripts/release-provenance.sh and is referenced in the
# release audit doc.
#
# Usage:
#   scripts/generate-sbom.sh [--output-dir DIR]
#
# Options:
#   --output-dir DIR  Where to write sbom.cyclonedx.json (default: <project>/output).
#
# Exit codes:
#   0  SBOM written
#   1  a required lockfile is missing, or a stack produced no components
#   2  usage error

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
project_root="$(cd -- "${script_dir}/.." && pwd -P)"
desktop_project="${project_root}/apps/desktop"

output_dir="${project_root}/output"

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  sed -n '2,46p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit 0
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --output-dir) output_dir="$2"; shift 2 ;;
    -*) printf 'error: unknown option: %s\n' "$1" >&2; exit 2 ;;
    *) printf 'error: unexpected argument: %s\n' "$1" >&2; exit 2 ;;
  esac
done

mkdir -p "${output_dir}"

python3 - "${output_dir}" "${project_root}" "${desktop_project}" <<'PY'
import json, os, sys, uuid
from datetime import datetime, timezone

output_dir, project_root, desktop_project = sys.argv[1:4]


def parse_toml_packages(path):
    """Parse `[[package]]` blocks (name/version/optional source) from a TOML
    lockfile without depending on tomllib, which is absent from the macOS
    system python3 (3.9) that the release gate may use."""
    with open(path, encoding="utf-8") as fh:
        text = fh.read()
    pkgs = []
    for block in text.split("[[package]]"):
        name = version = source = None
        for line in block.splitlines():
            line = line.strip()
            if line.startswith("name = "):
                name = line.split("=", 1)[1].strip().strip('"')
            elif line.startswith("version = "):
                version = line.split("=", 1)[1].strip().strip('"')
            elif line.startswith("source = "):
                src = line.split("=", 1)[1].strip()
                if src.startswith('"'):
                    source = src.strip('"')
        if name and version:
            pkgs.append({"name": name, "version": version, "source": source})
    return pkgs

# --- version (from tauri.conf.json) ---------------------------------------
version = "unknown"
tauri_conf = os.path.join(desktop_project, "src-tauri", "tauri.conf.json")
if os.path.isfile(tauri_conf):
    try:
        with open(tauri_conf, encoding="utf-8") as fh:
            version = json.load(fh).get("version") or version
    except Exception as exc:  # pragma: no cover - defensive
        print(f"warning: could not read version from {tauri_conf}: {exc}", file=sys.stderr)

# --- git commit sha + build time -------------------------------------------
commit = "unknown"
try:
    commit = os.popen(f"git -C {project_root} rev-parse HEAD 2>/dev/null").read().strip() or "unknown"
except Exception:  # pragma: no cover - defensive
    pass
build_time = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

# --- required lockfiles -----------------------------------------------------
uv_lock = os.path.join(project_root, "apps", "sidecar", "uv.lock")
cargo_lock = os.path.join(desktop_project, "src-tauri", "Cargo.lock")
pnpm_lock = os.path.join(project_root, "pnpm-lock.yaml")
if not os.path.isfile(pnpm_lock):
    pnpm_lock = os.path.join(desktop_project, "pnpm-lock.yaml")

missing = [p for p in (uv_lock, cargo_lock, pnpm_lock) if not os.path.isfile(p)]
if missing:
    for p in missing:
        print(f"error: required lockfile missing: {p}", file=sys.stderr)
    sys.exit(1)

components = []


def add(group, comp_type, name, version, purl):
    components.append({
        "type": comp_type,
        "bom-ref": purl,
        "group": group,
        "name": name,
        "version": version,
        "purl": purl,
    })


# --- Python sidecar (uv.lock) ----------------------------------------------
python_count = 0
for pkg in parse_toml_packages(uv_lock):
    name = pkg["name"]
    ver = pkg["version"]
    add("python", "library", name, ver, f"pkg:pypi/{name}@{ver}")
    python_count += 1
if python_count == 0:
    print(f"error: no Python packages found in {uv_lock}", file=sys.stderr)
    sys.exit(1)

# --- Rust shell (Cargo.lock) ------------------------------------------------
rust_count = 0
for pkg in parse_toml_packages(cargo_lock):
    name = pkg["name"]
    ver = pkg["version"]
    add("rust", "library", name, ver, f"pkg:cargo/{name}@{ver}")
    rust_count += 1
if rust_count == 0:
    print(f"error: no Rust packages found in {cargo_lock}", file=sys.stderr)
    sys.exit(1)

# --- Frontend (pnpm-lock.yaml) ---------------------------------------------
# Package keys live under the `packages:` section at 2-space indentation and
# look like `'@scope/name@version':` or `name@version:`. Split on the LAST '@'
# so scoped names (which contain a leading '@') parse correctly, and strip the
# surrounding single quotes.
js_count = 0
with open(pnpm_lock, encoding="utf-8") as fh:
    in_packages = False
    for line in fh:
        stripped = line.rstrip("\n")
        if stripped == "packages:":
            in_packages = True
            continue
        if not in_packages:
            continue
        if stripped == "":
            continue
        if stripped.startswith("    "):
            # nested (4+ space) blocks are not package keys; skip them
            continue
        if not stripped.startswith("  "):
            # reached a top-level key (e.g. `snapshots:`) -> packages section ends
            break
        key = stripped[2:].rstrip(":")
        if not key:
            continue
        if key.startswith("'") and key.endswith("'"):
            key = key[1:-1]
        if "@" not in key:
            continue
        name, _, ver = key.rpartition("@")
        name = name.strip()
        ver = ver.strip()
        if name and ver:
            add("javascript", "library", name, ver, f"pkg:npm/{name}@{ver}")
            js_count += 1
if js_count == 0:
    print(f"error: no frontend packages found in {pnpm_lock}", file=sys.stderr)
    sys.exit(1)

# De-duplicate by bom-ref (a package can appear once per lockfile) and sort for
# a deterministic, idempotent output.
seen = set()
unique = []
for c in components:
    if c["bom-ref"] not in seen:
        seen.add(c["bom-ref"])
        unique.append(c)
components = unique
components.sort(key=lambda c: (c["group"], c["name"].lower(), c["version"]))

bom = {
    "bomFormat": "CycloneDX",
    "specVersion": "1.5",
    "serialNumber": f"urn:uuid:{uuid.uuid4()}",
    "version": 1,
    "metadata": {
        "timestamp": build_time,
        "component": {
            "type": "application",
            "bom-ref": f"pkg:generic/voxstudio@{version}",
            "name": "VoxStudio",
            "version": version,
        },
        "properties": [
            {"name": "git:commit", "value": commit},
            {"name": "build:time", "value": build_time},
        ],
    },
    "components": components,
    "component_counts": {
        "python": python_count,
        "rust": rust_count,
        "javascript": js_count,
        "total": len(components),
    },
}

out = os.path.join(output_dir, "sbom.cyclonedx.json")
with open(out, "w", encoding="utf-8") as fh:
    json.dump(bom, fh, indent=2, ensure_ascii=False)
    fh.write("\n")

print(f"SBOM written to {out}")
print(f"  version   : {version}")
print(f"  commit    : {commit}")
print(f"  build_time: {build_time}")
print(f"  components: python={python_count}, rust={rust_count}, javascript={js_count}, total={len(components)}")
PY