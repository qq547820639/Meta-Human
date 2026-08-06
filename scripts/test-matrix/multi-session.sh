#!/usr/bin/env bash
#
# multi-session.sh — near-real multi-conversation independence test.
#
# Creates several conversations in parallel (asyncio.gather) through the
# sidecar's real ConversationRepository and asserts they are independent and
# all list correctly. This is a REAL execution of the sidecar's persistence
# code.

set -euo pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/lib.sh"

begin

SIDECAR_SRC="${TM_PROJECT_ROOT}/apps/sidecar/src"
DBDIR="$(cd "${TM_EVIDENCE_DIR}/.." && pwd -P)"
DB="${DBDIR}/multi-session.sqlite3"
PYFILE="${TM_EVIDENCE_DIR}/${TM_NAME}.py"
rm -f "${DB}" "${DB}.bak."*

cat > "${PYFILE}" <<'PY'
import asyncio
import sys

sys.path.insert(0, sys.argv[2])
from voxstudio_core.persistence.database import Database
from voxstudio_core.persistence.conversation_repository import (
    ConversationRepository,
)

db = Database(sys.argv[1])
CONVERSATIONS = 5
TITLES = [f"parallel-session-{i}" for i in range(CONVERSATIONS)]


async def main() -> None:
    await db.migrate()
    conversations = ConversationRepository(db)

    async def make(title: str):
        return await conversations.create(title=title)

    created = await asyncio.gather(*[make(title) for title in TITLES])

    ids = [c.id for c in created]
    assert len(set(ids)) == CONVERSATIONS, "conversation ids are not distinct"

    listed = {c.id: c for c in await conversations.list(limit=100)}
    for conversation in created:
        assert conversation.id in listed, f"missing conversation {conversation.id}"
        assert listed[conversation.id].title == conversation.title

    total = await conversations.count()
    assert total >= CONVERSATIONS, total

    print(f"created_ids={ids}")
    print(f"listed={len(listed)} total={total}")
    await db.close()
    print("MULTI_SESSION_OK")


asyncio.run(main())
PY

if ! uv run --project "${TM_PROJECT_ROOT}/apps/sidecar" python3 \
  "${PYFILE}" "${DB}" "${SIDECAR_SRC}" \
  > "${TM_EVIDENCE_DIR}/${TM_NAME}.log" 2>&1; then
  result FAIL session "parallel conversations were not independent / did not list correctly; see evidence log"
  rm -f "${PYFILE}"
  exit 0
fi
rm -f "${PYFILE}"

result PASS session "5 parallel conversations created, independent, and listed correctly"
exit 0