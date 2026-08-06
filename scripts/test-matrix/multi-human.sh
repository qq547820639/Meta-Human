#!/usr/bin/env bash
#
# multi-human.sh — near-real digital-human switching test.
#
# Creates / switches multiple digital humans through the sidecar's real
# DigitalHumanRepository and asserts default-human switching works. This is a
# REAL execution of the sidecar's persistence code.

set -euo pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/lib.sh"

begin

SIDECAR_SRC="${TM_PROJECT_ROOT}/apps/sidecar/src"
DBDIR="$(cd "${TM_EVIDENCE_DIR}/.." && pwd -P)"
DB="${DBDIR}/multi-human.sqlite3"
PYFILE="${TM_EVIDENCE_DIR}/${TM_NAME}.py"
rm -f "${DB}" "${DB}.bak."*

cat > "${PYFILE}" <<'PY'
import asyncio
import sys

sys.path.insert(0, sys.argv[2])
from voxstudio_core.persistence.database import Database
from voxstudio_core.persistence.digital_human_repository import (
    DigitalHumanRepository,
)

db = Database(sys.argv[1])


async def main() -> None:
    await db.migrate()
    humans = DigitalHumanRepository(db)

    h1 = await humans.create(name="Human-One", digital_human_id="mh-1")
    h2 = await humans.create(name="Human-Two", digital_human_id="mh-2")
    h3 = await humans.create(name="Human-Three", digital_human_id="mh-3")
    assert h1.id == "mh-1" and h2.id == "mh-2" and h3.id == "mh-3"

    # First created becomes the default.
    default = await humans.get_default()
    assert default is not None and default.id == "mh-1", default

    # Switch the default to a different human and back.
    await humans.set_default("mh-2")
    default = await humans.get_default()
    assert default is not None and default.id == "mh-2", default

    await humans.set_default("mh-3")
    default = await humans.get_default()
    assert default is not None and default.id == "mh-3", default

    await humans.set_default("mh-1")
    default = await humans.get_default()
    assert default is not None and default.id == "mh-1", default

    # All humans remain listed and independent.
    listed = await humans.list(limit=100)
    ids = {h.id for h in listed}
    assert ids == {"mh-1", "mh-2", "mh-3"}, ids

    print("default_switches=mh-1->mh-2->mh-3->mh-1")
    print(f"listed={sorted(ids)} default={default.id}")
    await db.close()
    print("MULTI_HUMAN_OK")


asyncio.run(main())
PY

if ! uv run --project "${TM_PROJECT_ROOT}/apps/sidecar" python3 \
  "${PYFILE}" "${DB}" "${SIDECAR_SRC}" \
  > "${TM_EVIDENCE_DIR}/${TM_NAME}.log" 2>&1; then
  result FAIL device "default human switching did not work; see evidence log"
  rm -f "${PYFILE}"
  exit 0
fi
rm -f "${PYFILE}"

result PASS device "3 digital humans created and default-human switching works"
exit 0