#!/usr/bin/env bash
#
# session-pagination.sh — near-real conversation message pagination test.
#
# Creates a conversation with 51 messages through the sidecar's real
# ConversationRepository / ConversationHistoryStore (via uv run) and asserts
# cursor pagination (page size 50) returns all 51+ messages across pages.
# This is a REAL execution of the sidecar's persistence code.

set -euo pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/lib.sh"

begin

SIDECAR_SRC="${TM_PROJECT_ROOT}/apps/sidecar/src"
DBDIR="$(cd "${TM_EVIDENCE_DIR}/.." && pwd -P)"
DB="${DBDIR}/session-pagination.sqlite3"
PYFILE="${TM_EVIDENCE_DIR}/${TM_NAME}.py"
rm -f "${DB}" "${DB}.bak."*

cat > "${PYFILE}" <<'PY'
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, sys.argv[2])
from voxstudio_core.persistence.database import Database
from voxstudio_core.persistence.conversation_repository import (
    ConversationRepository,
)
from voxstudio_core.knowledge.history import ConversationHistoryStore

db = Database(sys.argv[1])
TOTAL = 51
PAGE_SIZE = 50


async def main() -> None:
    await db.migrate()
    conversations = ConversationRepository(db)
    history = ConversationHistoryStore(db)
    conversation = await conversations.create(title="pagination-test")
    cid = conversation.id
    for i in range(TOTAL):
        role = "user" if i % 2 == 0 else "assistant"
        await history.append(
            role=role, content=f"message-{i}", conversation_id=cid
        )

    total = await history.count(conversation_id=cid)
    assert total == TOTAL, (total, TOTAL)

    page1 = await history.list_messages(
        conversation_id=cid, limit=PAGE_SIZE
    )
    assert len(page1.messages) == PAGE_SIZE, len(page1.messages)
    assert page1.has_more is True
    assert page1.next_cursor is not None

    page2 = await history.list_messages(
        conversation_id=cid,
        limit=PAGE_SIZE,
        before_id=int(page1.next_cursor),
    )
    assert len(page2.messages) == TOTAL - PAGE_SIZE, len(page2.messages)
    assert page2.has_more is False
    assert page2.next_cursor is None

    # First page is chronological; verify no overlap between pages.
    page1_ids = {m.content for m in page1.messages}
    page2_ids = {m.content for m in page2.messages}
    assert page1_ids.isdisjoint(page2_ids), "pages overlap"
    assert len(page1_ids | page2_ids) == TOTAL, "pages do not cover all messages"

    print(f"total_messages={total}")
    print(f"page1={len(page1.messages)} has_more={page1.has_more}")
    print(f"page2={len(page2.messages)} has_more={page2.has_more}")
    await db.close()
    print("PAGINATION_OK")


asyncio.run(main())
PY

if ! uv run --project "${TM_PROJECT_ROOT}/apps/sidecar" python3 \
  "${PYFILE}" "${DB}" "${SIDECAR_SRC}" \
  > "${TM_EVIDENCE_DIR}/${TM_NAME}.log" 2>&1; then
  result FAIL session "pagination did not return 51+ messages correctly; see evidence log"
  rm -f "${PYFILE}"
  exit 0
fi
rm -f "${PYFILE}"

result PASS session "51-message conversation paginated correctly across pages (page size 50)"
exit 0