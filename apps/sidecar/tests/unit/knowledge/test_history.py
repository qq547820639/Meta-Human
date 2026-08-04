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


@pytest.mark.asyncio
async def test_delete_last_assistant_scoped_to_conversation(
    database: Database,
) -> None:
    store = ConversationHistoryStore(database)
    await store.append(
        role="user",
        content="A问",
        conversation_id="conv-a",
    )
    await store.append(
        role="assistant",
        content="A答",
        conversation_id="conv-a",
    )
    await store.append(
        role="user",
        content="B问",
        conversation_id="conv-b",
    )
    await store.append(
        role="assistant",
        content="B答",
        conversation_id="conv-b",
    )

    # Deleting the last assistant of conv-a must leave conv-b untouched.
    assert await store.delete_last_assistant(conversation_id="conv-a") is True
    conv_a = await store.list_recent(conversation_id="conv-a")
    assert [(m.role, m.content) for m in conv_a] == [("user", "A问")]
    conv_b = await store.list_recent(conversation_id="conv-b")
    assert [(m.role, m.content) for m in conv_b] == [
        ("user", "B问"),
        ("assistant", "B答"),
    ]

    # Deleting with no matching message in the conversation returns False.
    assert await store.delete_last_assistant(conversation_id="conv-a") is False


@pytest.mark.asyncio
async def test_list_messages_cursor_paginates_by_conversation(
    database: Database,
) -> None:
    store = ConversationHistoryStore(database)
    await store.append(
        role="user",
        content="第一问",
        conversation_id="conv-a",
    )
    await store.append(
        role="assistant",
        content="第一答",
        conversation_id="conv-a",
    )
    await store.append(
        role="user",
        content="第一问",
        conversation_id="conv-b",
    )

    page = await store.list_messages(conversation_id="conv-a", limit=1)
    assert [(m.role, m.content) for m in page.messages] == [
        ("assistant", "第一答")
    ]
    assert page.has_more is True
    assert page.next_cursor is not None

    older = await store.list_messages(
        conversation_id="conv-a",
        limit=1,
        before_id=int(page.next_cursor),
    )
    assert [(m.role, m.content) for m in older.messages] == [
        ("user", "第一问")
    ]
    assert older.has_more is False
    assert older.next_cursor is None
