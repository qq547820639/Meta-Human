#!/usr/bin/env bash
#
# db-migration.sh — near-real DB migration test.
#
# Applies the sidecar's own persistence migrations to a fresh temporary SQLite
# database using the sidecar's real `Database.migrate()` code (via uv run) and
# asserts every migration applies cleanly and the schema version is current.
# This is a REAL execution of the sidecar's migration runner, not a mock.

set -euo pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/lib.sh"

begin

SIDECAR_SRC="${TM_PROJECT_ROOT}/apps/sidecar/src"
DBDIR="$(cd "${TM_EVIDENCE_DIR}/.." && pwd -P)"
DB="${DBDIR}/db-migration.sqlite3"
PYFILE="${TM_EVIDENCE_DIR}/${TM_NAME}.py"
rm -f "${DB}" "${DB}.bak."*

cat > "${PYFILE}" <<'PY'
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, sys.argv[2])
from voxstudio_core.persistence.database import Database, _migration_files

db = Database(sys.argv[1])


async def main() -> None:
    await db.migrate()
    files = _migration_files()
    versions = await db.applied_migration_versions()
    expected = tuple(version for version, _ in files)
    assert versions == expected, (
        "applied versions do not equal migration files",
        versions,
        expected,
    )
    async with db.transaction(immediate=False) as connection:
        cursor = await connection.execute("PRAGMA user_version")
        row = await cursor.fetchone()
        user_version = int(row[0]) if row else 0
    max_version = files[-1][0]
    print(f"applied={len(versions)} migrations: {versions}")
    print(f"user_version={user_version} max_migration={max_version}")
    # Every migration must be tracked AND the schema user_version must be
    # current (i.e. equal to the highest migration version).
    assert user_version == max_version, (user_version, max_version)
    await db.close()
    print("DB_MIGRATION_OK")


asyncio.run(main())
PY

if ! uv run --project "${TM_PROJECT_ROOT}/apps/sidecar" python3 \
  "${PYFILE}" "${DB}" "${SIDECAR_SRC}" \
  > "${TM_EVIDENCE_DIR}/${TM_NAME}.log" 2>&1; then
  result FAIL migration "migration did not apply cleanly; see evidence log"
  rm -f "${PYFILE}"
  exit 0
fi
rm -f "${PYFILE}"

count="$(awk '/^applied=/{gsub(/[^0-9]/,"",$1); print $1}' "${TM_EVIDENCE_DIR}/${TM_NAME}.log")"
result PASS migration "all ${count:-?} migrations applied cleanly; schema version is current"
exit 0