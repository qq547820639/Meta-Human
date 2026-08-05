from collections.abc import AsyncIterator
from pathlib import Path

import pytest
import pytest_asyncio

from voxstudio_core.persistence.database import Database
from voxstudio_core.persistence.memory_entry_repository import (
    MemoryEntryNotFoundError,
    MemoryEntryRepository,
    MemoryIgnoreRuleRepository,
)


@pytest_asyncio.fixture
async def repository(
    tmp_path: Path,
) -> AsyncIterator[tuple[Database, MemoryEntryRepository]]:
    database = Database(tmp_path / "memory_entries.sqlite3")
    await database.connect()
    await database.migrate()
    try:
        yield database, MemoryEntryRepository(database)
    finally:
        await database.close()


@pytest.mark.asyncio
async def test_create_and_get(repository) -> None:
    _, store = repository
    entry = await store.create(type="user_fact", content="用户喜欢咖啡")

    assert entry.type == "user_fact"
    assert entry.content == "用户喜欢咖啡"
    assert entry.confirmed_by_user is False
    assert entry.sensitive is False
    assert entry.conflict_group is None

    fetched = await store.get(entry.id)
    assert fetched.id == entry.id
    assert fetched.type == "user_fact"


@pytest.mark.asyncio
async def test_create_rejects_empty_content(repository) -> None:
    _, store = repository
    with pytest.raises(ValueError):
        await store.create(type="user_fact", content="   ")


@pytest.mark.asyncio
async def test_list_orders_by_created_desc_and_filters_by_type(repository) -> None:
    _, store = repository
    first = await store.create(type="user_fact", content="事实甲")
    second = await store.create(type="preference", content="偏好乙")

    all_rows = await store.list()
    assert [row.id for row in all_rows] == [second.id, first.id]

    facts = await store.list(type="user_fact")
    assert [row.id for row in facts] == [first.id]

    none = await store.list(type="goal")
    assert none == ()


@pytest.mark.asyncio
async def test_get_missing_raises(repository) -> None:
    _, store = repository
    with pytest.raises(MemoryEntryNotFoundError):
        await store.get("missing")


@pytest.mark.asyncio
async def test_update_content_sets_flags_and_deletes(repository) -> None:
    _, store = repository
    entry = await store.create(type="user_fact", content="旧内容")

    updated = await store.update_content(entry.id, content="新内容")
    assert updated.content == "新内容"

    confirmed = await store.set_confirmed(entry.id, confirmed=True)
    assert confirmed.confirmed_by_user is True

    sensitive = await store.set_sensitive(entry.id, sensitive=True)
    assert sensitive.sensitive is True

    await store.delete(entry.id)
    with pytest.raises(MemoryEntryNotFoundError):
        await store.get(entry.id)


@pytest.mark.asyncio
async def test_update_missing_raises(repository) -> None:
    _, store = repository
    with pytest.raises(MemoryEntryNotFoundError):
        await store.update_content("missing", content="x")
    with pytest.raises(MemoryEntryNotFoundError):
        await store.set_confirmed("missing", confirmed=True)
    with pytest.raises(MemoryEntryNotFoundError):
        await store.set_sensitive("missing", sensitive=True)
    with pytest.raises(MemoryEntryNotFoundError):
        await store.delete("missing")


@pytest.mark.asyncio
async def test_clear_all_count_and_search(repository) -> None:
    _, store = repository
    await store.create(type="user_fact", content="用户使用外骨骼")
    await store.create(type="preference", content="用户偏好安静")

    assert await store.count() == 2

    hits = await store.search(query="外骨骼")
    assert [row.content for row in hits] == ["用户使用外骨骼"]

    misses = await store.search(query="不存在")
    assert misses == ()

    await store.clear_all()
    assert await store.count() == 0
    assert await store.list() == ()


@pytest.mark.asyncio
async def test_pin_and_disable_are_persisted(repository) -> None:
    _, store = repository
    entry = await store.create(type="user_fact", content="内容")

    pinned = await store.set_pinned(entry.id, pinned=True)
    assert pinned.pinned is True

    disabled = await store.set_disabled(entry.id, disabled=True)
    assert disabled.disabled is True

    fetched = await store.get(entry.id)
    assert fetched.pinned is True
    assert fetched.disabled is True

    # Disabled entries are excluded from the active listing.
    active = await store.list(include_disabled=False)
    assert active == ()


@pytest.mark.asyncio
async def test_list_filters_by_source_and_scope(repository) -> None:
    _, store = repository
    await store.create(type="user_fact", content="显式记忆", source="user")
    await store.create(type="preference", content="摘要记忆", source="system")
    await store.create(
        type="preference",
        content="数字人记忆",
        source="system",
        scope="digital_human",
        scope_id="dh-1",
    )

    user = await store.list(source="user")
    assert [row.content for row in user] == ["显式记忆"]

    scoped = await store.list(scope="digital_human", scope_id="dh-1")
    assert [row.content for row in scoped] == ["数字人记忆"]

    others = await store.list(scope="digital_human", scope_id="dh-9")
    assert others == ()


@pytest.mark.asyncio
async def test_create_validates_scope_rules(repository) -> None:
    _, store = repository
    with pytest.raises(ValueError):
        await store.create(type="user_fact", content="x", scope="global", scope_id="s")
    with pytest.raises(ValueError):
        await store.create(type="user_fact", content="x", scope="conversation")
    with pytest.raises(ValueError):
        await store.create(type="user_fact", content="x", source="bogus")


@pytest.mark.asyncio
async def test_exists_reflects_persistence(repository) -> None:
    _, store = repository
    entry = await store.create(type="user_fact", content="存在")
    assert await store.exists(entry.id) is True
    await store.delete(entry.id)
    assert await store.exists(entry.id) is False


@pytest.mark.asyncio
async def test_ignore_rule_repository_round_trip(repository) -> None:
    database, _ = repository
    rules = MemoryIgnoreRuleRepository(database)
    rule = await rules.create(type="preference")
    assert rule.type == "preference"
    assert rule.scope == "global"

    # Idempotent creation returns the same rule.
    again = await rules.create(type="preference")
    assert again.id == rule.id

    listed = await rules.list()
    assert [r.id for r in listed] == [rule.id]

    await rules.delete(rule.id)
    assert await rules.list() == ()
