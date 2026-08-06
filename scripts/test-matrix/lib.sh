#!/usr/bin/env bash
#
# lib.sh — shared helpers for the test-matrix item scripts.
#
# This file is intended to be *sourced*, not executed. Sourcing it defines the
# functions below and causes no side effects. Each item script is otherwise
# self-contained: it sources this file, runs its real check, and emits exactly
# one machine-readable RESULT line that run-test-matrix.sh parses.
#
# Contract:
#   * `begin`            — create the evidence dir and truncate this item's log.
#   * `log <line>`       — append a line to this item's evidence log.
#   * `result <status> <category> <note>` — emit the RESULT line for the runner
#                          and append a summary line to the evidence log.
#
# RESULT line format (piped, 5 fields):
#   RESULT|<name>|<category>|<status>|<evidence>
# where status is one of PASS | FAIL | UNVERIFIED and evidence is a path
# relative to the project root.

set -euo pipefail

# Resolve the repository root (two levels up from scripts/test-matrix/).
TM_PROJECT_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"

# Evidence directory. Overridable so the runner can pass its own output dir.
TM_EVIDENCE_DIR="${OUTPUT_DIR:-${TM_PROJECT_ROOT}/output/test-matrix}/evidences"

# Each item is named after its script file (e.g. db-migration.sh -> db-migration).
TM_NAME="${TM_NAME:-$(basename "$0" .sh)}"

# bash's $SECONDS auto-increments; capture when we started.
TM_START="${SECONDS:-0}"

TM_EVIDENCE_REL="output/test-matrix/evidences/${TM_NAME}.log"

begin() {
  mkdir -p "${TM_EVIDENCE_DIR}"
  : > "${TM_EVIDENCE_DIR}/${TM_NAME}.log"
}

log() {
  printf '%s\n' "$*" >> "${TM_EVIDENCE_DIR}/${TM_NAME}.log"
}

result() {
  local status="$1"
  local category="$2"
  local note="${3:-}"
  local runtime=$((SECONDS > TM_START ? SECONDS - TM_START : 0))
  log "status=${status} category=${category} note=${note} runtime=${runtime}s"
  log "evidence=${TM_EVIDENCE_REL}"
  printf 'RESULT|%s|%s|%s|%s\n' \
    "${TM_NAME}" "${category}" "${status}" "${TM_EVIDENCE_REL}"
}