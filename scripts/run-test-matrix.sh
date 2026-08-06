#!/usr/bin/env bash
#
# run-test-matrix.sh — real / near-real test matrix runner.
#
# Runs every near-real test that can execute on THIS local macOS machine and
# honestly records each item's environment, commit, result, evidence file, and
# runtime in output/test-matrix.json and output/test-matrix.md. Items that
# genuinely require hardware / credentials / distribution endpoints are recorded
# as UNVERIFIED (never faked as PASS).
#
# Usage:
#   scripts/run-test-matrix.sh
#
# Exit codes:
#   0  no FAIL items (UNVERIFIED items are allowed)
#   1  at least one FAIL item

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
project_root="$(cd -- "${script_dir}/.." && pwd -P)"
output_dir="${project_root}/output/test-matrix"
evidence_dir="${output_dir}/evidences"
json_path="${project_root}/output/test-matrix.json"
md_path="${project_root}/output/test-matrix.md"
results_tsv="${output_dir}/.results.tsv"

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  cat <<'EOF'
Usage: scripts/run-test-matrix.sh

Runs every near-real test that can run on this local macOS machine and writes:

  output/test-matrix.json   structured per-item report
  output/test-matrix.md     human-readable per-item report

Each item records: name, category, status (PASS/FAIL/UNVERIFIED), evidence
file path, and runtime. Near-real items exercise the real sidecar / repos /
clients. Anything requiring real hardware, credentials, or a distribution
endpoint is recorded honestly as UNVERIFIED.

Exit code 0 when there are no FAIL items (UNVERIFIED is allowed); exit 1 when
any item FAILs.
EOF
  exit 0
fi

mkdir -p "${evidence_dir}"
: > "${results_tsv}"
export OUTPUT_DIR="${output_dir}"

# ---------------------------------------------------------------------------
# Environment capture
# ---------------------------------------------------------------------------

timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
commit="$(git -C "${project_root}" rev-parse HEAD 2>/dev/null || echo unknown)"
branch="$(git -C "${project_root}" branch --show-current 2>/dev/null || echo unknown)"
version="$(
  python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["version"])' \
    "${project_root}/apps/desktop/src-tauri/tauri.conf.json" 2>/dev/null \
    || echo unknown
)"
os_version="$(sw_vers -productVersion 2>/dev/null || echo unknown)"
os_build="$(sw_vers -buildVersion 2>/dev/null || echo unknown)"
arch="$(uname -m 2>/dev/null || echo unknown)"
node_version="$(node -v 2>/dev/null || echo unknown)"
pnpm_version="$(pnpm -v 2>/dev/null || echo unknown)"
uv_version="$(uv --version 2>/dev/null || echo unknown)"
rustc_version="$(rustc --version 2>/dev/null || echo unknown)"
machine_desc="${os_version} (${os_build}) ${arch}"

# ---------------------------------------------------------------------------
# Item execution
# ---------------------------------------------------------------------------

SCRIPT_DIR="${script_dir}/test-matrix"

# name|category|path  — the near-real items that can execute locally.
near_real_items=(
  "sidecar-crash|crash|${SCRIPT_DIR}/sidecar-crash.sh"
  "no-network|network|${SCRIPT_DIR}/no-network.sh"
  "db-migration|migration|${SCRIPT_DIR}/db-migration.sh"
  "session-pagination|session|${SCRIPT_DIR}/session-pagination.sh"
  "multi-session|session|${SCRIPT_DIR}/multi-session.sh"
  "multi-human|device|${SCRIPT_DIR}/multi-human.sh"
  "offline-queue|network|${SCRIPT_DIR}/offline-queue.sh"
  "disk-full|disk|${SCRIPT_DIR}/disk-full.sh"
  "permission|permission|${SCRIPT_DIR}/permission.sh"
)

run_item() {
  local entry="$1"
  local name category script
  name="${entry%%|*}"
  local rest="${entry#*|}"
  category="${rest%%|*}"
  script="${rest#*|}"

  local start_ms end_ms runtime_ms line status evidence
  start_ms="$(( $(date +%s%N) / 1000000 ))"

  local out
  out="$("${script}" 2>&1)" || true
  end_ms="$(( $(date +%s%N) / 1000000 ))"
  runtime_ms="$(( end_ms - start_ms ))"

  line="$(printf '%s\n' "${out}" | grep -E '^RESULT\|' | tail -n 1 || true)"
  if [[ -z "${line}" ]]; then
    status="FAIL"
    evidence="output/test-matrix/evidences/${name}.log"
    printf '%s\n' "${out}" >> "${evidence_dir}/${name}.log"
    printf 'FAIL  %s (%s) — no RESULT line emitted\n' "${name}" "${category}"
  else
    IFS='|' read -r _ _ _ status evidence <<<"${line}"
    printf '%s  %s (%s)  [%sms]\n' "${status}" "${name}" "${category}" "${runtime_ms}"
  fi
  printf '%s\t%s\t%s\t%s\t%s\n' "${name}" "${category}" "${status}" "${evidence}" "${runtime_ms}" >> "${results_tsv}"
}

printf '== VoxStudio test matrix ==\n'
printf 'commit: %s\nbranch: %s\nversion: %s\nmachine: %s\narch: %s\n' \
  "${commit}" "${branch}" "${version}" "${machine_desc}" "${arch}"
printf '%s\n\n' "-- running near-real items --"

for entry in "${near_real_items[@]}"; do
  run_item "${entry}"
done

# ---------------------------------------------------------------------------
# Items that genuinely require hardware / credentials / distribution — UNVERIFIED
# ---------------------------------------------------------------------------

unverified_items=(
  "clean-mac-first-install|install|requires a clean virtual machine / fresh macOS with no prior VoxStudio state"
  "intel-mac|install|requires an Intel Mac host; this machine is Apple Silicon (${arch})"
  "overlay-upgrade|upgrade|requires a previously installed release build to upgrade over (needs a signed/notarized installer)"
  "downgrade-block|upgrade|requires a signed older release and the updater downgrade guard against a real installed version"
  "update-failure|upgrade|requires a real distribution endpoint / signed updater artifact to fail against"
  "airpods-headset|device|requires physical AirPods paired to the Mac for wireless audio routing"
  "system-sleep-wake|power|requires an unattended real sleep/wake cycle of the host; cannot be simulated safely"
)

for entry in "${unverified_items[@]}"; do
  name="${entry%%|*}"
  rest="${entry#*|}"
  category="${rest%%|*}"
  reason="${rest#*|}"
  evidence="output/test-matrix/evidences/${name}.log"
  {
    printf 'status=UNVERIFIED\ncategory=%s\nreason=%s\n' "${category}" "${reason}"
    printf 'evidence=%s\n' "${evidence}"
  } > "${evidence_dir}/${name}.log"
  printf 'UNVERIFIED  %s (%s) — %s\n' "${name}" "${category}" "${reason}"
  printf '%s\t%s\tUNVERIFIED\t%s\t0\n' "${name}" "${category}" "${evidence}" >> "${results_tsv}"
done

# ---------------------------------------------------------------------------
# Report generation (JSON + Markdown)
# ---------------------------------------------------------------------------

python3 - "${json_path}" "${md_path}" "${results_tsv}" \
  "${commit}" "${branch}" "${version}" "${machine_desc}" \
  "${os_version}" "${os_build}" "${arch}" \
  "${node_version}" "${pnpm_version}" "${uv_version}" "${rustc_version}" \
  "${timestamp}" <<'PY'
import csv
import json
import sys

json_path, md_path, tsv_path = sys.argv[1], sys.argv[2], sys.argv[3]
(
    commit, branch, version, machine, os_version, os_build, arch,
    node_version, pnpm_version, uv_version, rustc_version, timestamp,
) = sys.argv[4:]

items = []
with open(tsv_path, newline="", encoding="utf-8") as fh:
    for row in csv.reader(fh, delimiter="\t"):
        if not row or len(row) < 5:
            continue
        name, category, status, evidence, runtime_ms = row[:5]
        items.append({
            "name": name,
            "category": category,
            "status": status,
            "evidence": evidence,
            "runtime_ms": int(runtime_ms),
        })

pass_count = sum(1 for i in items if i["status"] == "PASS")
fail_count = sum(1 for i in items if i["status"] == "FAIL")
unverified_count = sum(1 for i in items if i["status"] == "UNVERIFIED")

report = {
    "schema": "voxstudio-test-matrix@1",
    "generated_at": timestamp,
    "environment": {
        "commit": commit,
        "branch": branch,
        "version": version,
        "os": {"product_version": os_version, "build_version": os_build, "arch": arch},
        "machine": machine,
        "toolchain": {
            "node": node_version,
            "pnpm": pnpm_version,
            "uv": uv_version,
            "rustc": rustc_version,
        },
    },
    "summary": {
        "total": len(items),
        "pass": pass_count,
        "fail": fail_count,
        "unverified": unverified_count,
    },
    "items": items,
}

with open(json_path, "w", encoding="utf-8") as fh:
    json.dump(report, fh, ensure_ascii=False, indent=2)
    fh.write("\n")

with open(md_path, "w", encoding="utf-8") as fh:
    fh.write(f"# VoxStudio 测试矩阵报告\n\n")
    fh.write(f"- 提交: `{commit}`\n")
    fh.write(f"- 分支: `{branch}`\n")
    fh.write(f"- 版本: `{version}`\n")
    fh.write(f"- 机器: `{machine}`\n")
    fh.write(f"- 时间戳: `{timestamp}`\n")
    fh.write(f"- 工具链: node {node_version} / pnpm {pnpm_version} / uv {uv_version} / rustc {rustc_version}\n\n")
    fh.write(f"## 汇总\n\n")
    fh.write(f"| 状态 | 数量 |\n|---|---|\n")
    fh.write(f"| PASS | {pass_count} |\n")
    fh.write(f"| FAIL | {fail_count} |\n")
    fh.write(f"| UNVERIFIED | {unverified_count} |\n\n")
    fh.write(f"## 明细\n\n")
    fh.write(f"| 项目 | 分类 | 状态 | 耗时(ms) | 证据文件 |\n")
    fh.write(f"|---|---|---|---|---|\n")
    for item in items:
        fh.write(
            f"| {item['name']} | {item['category']} | {item['status']} "
            f"| {item['runtime_ms']} | {item['evidence']} |\n"
        )
    fh.write("\n注: UNVERIFIED 表示需要真实硬件/凭据/分发端点，本次未实际验证，绝不伪造为 PASS。\n")

print(
    f"\n== summary: {pass_count} PASS, {fail_count} FAIL, {unverified_count} UNVERIFIED "
    f"(total {len(items)}) =="
)
print(f"report: {json_path}")
print(f"report: {md_path}")
PY

# ---------------------------------------------------------------------------
# Exit code
# ---------------------------------------------------------------------------

bash_fail_count="$(awk -F '\t' '$3=="FAIL"{n++} END{print n+0}' "${results_tsv}")"
if [[ "${bash_fail_count}" -eq 0 ]]; then
  printf 'Test matrix completed: 0 FAIL. Exit 0.\n'
  exit 0
fi
printf 'Test matrix completed: %s FAIL. Exit 1.\n' "${bash_fail_count}"
exit 1