from collections.abc import AsyncIterator
from pathlib import Path

import pytest
import pytest_asyncio

from voxstudio_core.knowledge.history import (
    ConversationHistoryStore,
    ConversationMessage,
)
from voxstudio_core.persistence.database import Database


@pytest_asyncio.fixture
async def database(tmp_path: Path) -> AsyncIterator[Database]:
    database = Database(tmp_path / "history.sqlite3")
    await database.connect()
    await database.migrate()
    try:
        yield database
    finally:
        await database.close()


@pytest.mark.asyncio
async def test_history_round_trips_and_limits_recent_messages(
    database: Database,
) -> None:
    store = ConversationHistoryStore(database)

    await store.append(role="user", content="第一问")
    await store.append(role="assistant", content="第一答")
    await store.append(role="user", content="第二问")

    recent = await store.list_recent(limit=2)

    assert [(message.role, message.content) for message in recent] == [
        ("assistant", "第一答"),
        ("user", "第二问"),
    ]
    assert await store.count() == 3

    await store.clear()
    assert await store.list_recent() == ()
    assert await store.count() == 0


@pytest.mark.asyncio
async def test_history_rejects_invalid_roles_and_empty_content(
    database: Database,
) -> None:
    store = ConversationHistoryStore(database)

    with pytest.raises(ValueError):
        await store.append(role="system", content="bad")
    with pytest.raises(ValueError):
        await store.append(role="user", content="   ")


@pytest.mark.asyncio
async def test_history_round_trips_citations_and_grounding(
    database: Database,
) -> None:
    store = ConversationHistoryStore(database)
    await store.append(
        role="assistant",
        content="引用了来源的回答",
        citations=("[项目验收手册]", "[设备维护说明]"),
        citation_urls=(
            "https://feishu.cn/docx/doc-1",
            None,
        ),
        grounded=True,
    )

    recent = await store.list_recent()

    assert recent == (
        ConversationMessage(
            role="assistant",
            content="引用了来源的回答",
            citations=("[项目验收手册]", "[设备维护说明]"),
            citation_urls=(
                "https://feishu.cn/docx/doc-1",
                None,
            ),
            grounded=True,
            created_at=recent[0].created_at,
        ),
    )
    assert recent[0].created_at is not None


@pytest.mark.asyncio
async def test_delete_last_assistant_only_removes_latest_reply(
    database: Database,
) -> None:
    store = ConversationHistoryStore(database)
    await store.append(role="user", content="第一问")
    await store.append(role="assistant", content="第一答")
    await store.append(role="user", content="第二问")
    await store.append(role="assistant", content="第二答")

    assert await store.delete_last_assistant() is True
    recent = await store.list_recent()
    assert [(message.role, message.content) for message in recent] == [
        ("user", "第一问"),
        ("assistant", "第一答"),
        ("user", "第二问"),
    ]

    assert await store.delete_last_assistant() is True
    assert await store.delete_last_assistant() is False
