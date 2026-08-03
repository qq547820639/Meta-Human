from collections.abc import AsyncIterator
from pathlib import Path

import pytest
import pytest_asyncio

from voxstudio_core.persistence.conversation_repository import (
    DEFAULT_TITLE,
    ConversationNotFoundError,
    ConversationRepository,
)
from voxstudio_core.persistence.database import Database


@pytest_asyncio.fixture
async def repository(
    tmp_path: Path,
) -> AsyncIterator[tuple[Database, ConversationRepository]]:
    database = Database(tmp_path / "conversations.sqlite3")
    await database.connect()
    await database.migrate()
    try:
        yield database, ConversationRepository(database)
    finally:
        await database.close()


@pytest.mark.asyncio
async def test_create_uses_default_title_and_records_avatar(
    repository,
) -> None:
    _, store = repository
    conversation = await store.create(avatar_id="avatar-1")

    assert conversation.title == DEFAULT_TITLE
    assert conversation.avatar_id == "avatar-1"
    assert conversation.archived is False
    assert conversation.deleted is False
    assert conversation.last_message_at is None


@pytest.mark.asyncio
async def test_create_accepts_custom_title_and_blank_falls_back_to_default(
    repository,
) -> None:
    _, store = repository
    custom = await store.create(title="我的对话")
    assert custom.title == "我的对话"

    blank = await store.create(title="   ")
    assert blank.title == DEFAULT_TITLE


@pytest.mark.asyncio
async def test_list_orders_by_updated_at_descending(repository) -> None:
    _, store = repository
    first = await store.create(title="A")
    second = await store.create(title="B")

    rows = await store.list()
    assert [row.id for row in rows] == [second.id, first.id]


@pytest.mark.asyncio
async def test_list_supports_pagination_and_archived_filter(repository) -> None:
    _, store = repository
    first = await store.create(title="A")
    second = await store.create(title="B")
    await store.archive(second.id, archived=True)

    archived = await store.list(include_archived=True)
    assert {row.id for row in archived} == {first.id, second.id}

    active = await store.list(include_archived=False)
    assert [row.id for row in active] == [first.id]

    page = await store.list(limit=1, offset=0)
    assert len(page) == 1


@pytest.mark.asyncio
async def test_get_missing_raises(repository) -> None:
    _, store = repository
    with pytest.raises(ConversationNotFoundError):
        await store.get("missing")


@pytest.mark.asyncio
async def test_rename_updates_title(repository) -> None:
    _, store = repository
    conversation = await store.create(title="A")
    renamed = await store.rename(conversation.id, title="B")

    assert renamed.title == "B"
    assert (await store.get(conversation.id)).title == "B"


@pytest.mark.asyncio
async def test_rename_missing_raises(repository) -> None:
    _, store = repository
    with pytest.raises(ConversationNotFoundError):
        await store.rename("missing", title="B")


@pytest.mark.asyncio
async def test_delete_is_soft_and_hides_from_list(repository) -> None:
    _, store = repository
    conversation = await store.create(title="A")

    await store.delete(conversation.id)

    assert (await store.get(conversation.id)).deleted is True
    assert [row.id for row in await store.list()] == []


@pytest.mark.asyncio
async def test_archive_flips_flag(repository) -> None:
    _, store = repository
    conversation = await store.create(title="A")

    archived = await store.archive(conversation.id, archived=True)
    assert archived.archived is True

    restored = await store.archive(conversation.id, archived=False)
    assert restored.archived is False


@pytest.mark.asyncio
async def test_clear_removes_messages_and_resets_last_message(repository) -> None:
    database, store = repository
    conversation = await store.create(title="A")
    async with database.transaction() as connection:
        await connection.execute(
            "INSERT INTO conversation_messages (role, content, conversation_id) "
            "VALUES ('user', 'hi', ?)",
            (conversation.id,),
        )
    await store.set_last_message(conversation.id)

    await store.clear(conversation.id)

    reloaded = await store.get(conversation.id)
    assert reloaded.last_message_at is None
    async with database.transaction(immediate=False) as connection:
        async with connection.execute(
            "SELECT COUNT(*) AS total FROM conversation_messages WHERE conversation_id = ?",
            (conversation.id,),
        ) as cursor:
            row = await cursor.fetchone()
    assert row["total"] == 0


@pytest.mark.asyncio
async def test_search_matches_title_and_message_content(repository) -> None:
    database, store = repository
    by_title = await store.create(title="飞行器使用指南")
    async with database.transaction() as connection:
        await connection.execute(
            "INSERT INTO conversation_messages (role, content, conversation_id) "
            "VALUES ('user', '关于外骨骼的提问', ?)",
            (by_title.id,),
        )

    title_hits = await store.search(query="飞行器")
    assert [row.id for row in title_hits] == [by_title.id]

    content_hits = await store.search(query="外骨骼")
    assert [row.id for row in content_hits] == [by_title.id]

    no_hits = await store.search(query="不存在的内容")
    assert no_hits == ()


@pytest.mark.asyncio
async def test_count_excludes_deleted(repository) -> None:
    _, store = repository
    first = await store.create(title="A")
    await store.create(title="B")

    assert await store.count() == 2
    assert await store.count(include_deleted=True) == 2

    await store.delete(first.id)
    assert await store.count() == 1
    assert await store.count(include_deleted=True) == 2


@pytest.mark.asyncio
async def test_set_last_message_touches_updated_at(repository) -> None:
    _, store = repository
    conversation = await store.create(title="A")

    await store.set_last_message(conversation.id)

    reloaded = await store.get(conversation.id)
    assert reloaded.last_message_at is not None