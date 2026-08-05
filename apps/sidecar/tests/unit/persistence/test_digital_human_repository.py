from collections.abc import AsyncIterator
from pathlib import Path

import pytest
import pytest_asyncio

from voxstudio_core.persistence.database import Database
from voxstudio_core.persistence.digital_human_repository import (
    DigitalHumanNotFoundError,
    DigitalHumanRepository,
    DigitalHumanStatus,
)


@pytest_asyncio.fixture
async def repository(
    tmp_path: Path,
) -> AsyncIterator[tuple[Database, DigitalHumanRepository]]:
    database = Database(tmp_path / "digital_humans.sqlite3")
    await database.connect()
    await database.migrate()
    try:
        yield database, DigitalHumanRepository(database)
    finally:
        await database.close()


@pytest.mark.asyncio
async def test_create_marks_first_as_default(repository) -> None:
    _, store = repository
    first = await store.create(name="Bob")
    second = await store.create(name="Alice")

    assert first.is_default is True
    assert second.is_default is False
    assert first.creation_status is DigitalHumanStatus.PENDING


@pytest.mark.asyncio
async def test_set_default_switches_default(repository) -> None:
    _, store = repository
    first = await store.create(name="Bob")
    second = await store.create(name="Alice")

    updated = await store.set_default(second.id)

    assert updated.is_default is True
    assert (await store.get_default()).id == second.id
    assert (await store.get(first.id)).is_default is False


@pytest.mark.asyncio
async def test_update_status_persists_voice_and_avatar(repository) -> None:
    _, store = repository
    human = await store.create(name="Bob")

    updated = await store.update_status(
        human.id,
        status=DigitalHumanStatus.READY,
        progress="done",
        voice_id="voice-1",
        avatar_id="avatar-1",
    )

    assert updated.creation_status is DigitalHumanStatus.READY
    assert updated.voice_id == "voice-1"
    assert updated.avatar_id == "avatar-1"

    reloaded = await store.get(human.id)
    assert reloaded.voice_id == "voice-1"
    assert reloaded.avatar_id == "avatar-1"


@pytest.mark.asyncio
async def test_rename_and_delete(repository) -> None:
    _, store = repository
    human = await store.create(name="Bob")

    renamed = await store.rename(human.id, name="Bobby")
    assert renamed.name == "Bobby"

    await store.delete(human.id)
    with pytest.raises(DigitalHumanNotFoundError):
        await store.get(human.id)


@pytest.mark.asyncio
async def test_list_orders_default_first(repository) -> None:
    _, store = repository
    first = await store.create(name="Bob")
    second = await store.create(name="Alice")

    rows = await store.list()

    assert [row.id for row in rows] == [first.id, second.id]
    assert rows[0].is_default is True


@pytest.mark.asyncio
async def test_get_missing_raises(repository) -> None:
    _, store = repository
    with pytest.raises(DigitalHumanNotFoundError):
        await store.get("missing")


@pytest.mark.asyncio
async def test_list_supports_pagination_without_duplicates(repository) -> None:
    _, store = repository
    for index in range(55):
        await store.create(name=f"Human-{index}")

    page1 = await store.list(limit=50, offset=0)
    assert len(page1) == 50

    page2 = await store.list(limit=50, offset=50)
    assert len(page2) == 5

    ids = [row.id for row in (*page1, *page2)]
    assert len(ids) == len(set(ids)), "pages must not overlap (no duplicates)"
    assert await store.count() == 55
