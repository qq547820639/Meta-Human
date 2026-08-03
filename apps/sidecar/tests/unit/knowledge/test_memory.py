from collections.abc import AsyncIterator
from pathlib import Path

import pytest
import pytest_asyncio

from voxstudio_core.knowledge.memory import ConversationMemoryStore
from voxstudio_core.persistence.database import Database


@pytest_asyncio.fixture
async def database(tmp_path: Path) -> AsyncIterator[Database]:
    database = Database(tmp_path / "memory.sqlite3")
    await database.connect()
    await database.migrate()
    try:
        yield database
    finally:
        await database.close()


@pytest.mark.asyncio
async def test_memory_saves_loads_latest_and_clears(
    database: Database,
) -> None:
    store = ConversationMemoryStore(database)

    assert await store.load_latest() is None

    await store.save(summary="第一条记忆")
    await store.save(summary="第二条记忆")

    memory = await store.load_latest()
    assert memory is not None
    assert memory.summary == "第二条记忆"

    await store.clear()
    assert await store.load_latest() is None


@pytest.mark.asyncio
async def test_memory_rejects_empty_summary(database: Database) -> None:
    store = ConversationMemoryStore(database)

    with pytest.raises(ValueError):
        await store.save(summary="   ")
