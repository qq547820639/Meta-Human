from collections.abc import AsyncIterator
from pathlib import Path

import pytest
import pytest_asyncio

from voxstudio_core.persistence.build_job_repository import (
    BuildJobRepository,
    BuildJobStatus,
    CleanupState,
)
from voxstudio_core.persistence.database import Database
from voxstudio_core.persistence.digital_human_repository import (
    DigitalHumanRepository,
)


@pytest_asyncio.fixture
async def repository(
    tmp_path: Path,
) -> AsyncIterator[tuple[Database, BuildJobRepository, DigitalHumanRepository]]:
    database = Database(tmp_path / "build_jobs.sqlite3")
    await database.connect()
    await database.migrate()
    try:
        yield database, BuildJobRepository(database), DigitalHumanRepository(
            database
        )
    finally:
        await database.close()


async def _make_human(humans: DigitalHumanRepository, name: str) -> str:
    created = await humans.create(name=name)
    return created.id


@pytest.mark.asyncio
async def test_create_defaults_cleanup_state_to_none(repository) -> None:
    _, store, humans = repository
    human_id = await _make_human(humans, "Bob")
    job = await store.create(
        portrait_path="/p.jpg",
        recording_path="/v.wav",
        digital_human_id=human_id,
        provider="gpu-provider",
    )
    assert job.digital_human_id == human_id
    assert job.provider == "gpu-provider"
    assert job.cleanup_state is CleanupState.NONE
    assert job.last_error is None
    assert job.remote_resource_id is None


@pytest.mark.asyncio
async def test_update_persists_remote_metadata(repository) -> None:
    _, store, humans = repository
    human_id = await _make_human(humans, "Bob")
    job = await store.create(
        portrait_path="/p.jpg",
        recording_path="/v.wav",
        digital_human_id=human_id,
    )
    updated = await store.update(
        job.id,
        status=BuildJobStatus.SUCCEEDED,
        remote_resource_id='["voice-1", "avatar-1"]',
        cleanup_state=CleanupState.SUCCEEDED,
        last_error="cleaned ok",
    )
    assert updated.remote_resource_id == '["voice-1", "avatar-1"]'
    assert updated.cleanup_state is CleanupState.SUCCEEDED
    assert updated.last_error == "cleaned ok"

    reloaded = await store.get(job.id)
    assert reloaded.remote_resource_id == '["voice-1", "avatar-1"]'
    assert reloaded.cleanup_state is CleanupState.SUCCEEDED
    assert reloaded.last_error == "cleaned ok"


@pytest.mark.asyncio
async def test_latest_for_digital_human_returns_most_recent(repository) -> None:
    _, store, humans = repository
    human_id = await _make_human(humans, "Bob")
    other_id = await _make_human(humans, "Alice")
    await store.create(
        portrait_path="/a.jpg",
        recording_path="/a.wav",
        digital_human_id=human_id,
    )
    second = await store.create(
        portrait_path="/b.jpg",
        recording_path="/b.wav",
        digital_human_id=human_id,
    )
    # A job for a different human must never leak into this human's latest.
    await store.create(
        portrait_path="/c.jpg",
        recording_path="/c.wav",
        digital_human_id=other_id,
    )

    latest = await store.latest_for_digital_human(human_id)
    assert latest is not None
    assert latest.id == second.id

    assert await store.latest_for_digital_human("human-missing") is None


@pytest.mark.asyncio
async def test_list_for_digital_human_orders_and_paginates(repository) -> None:
    _, store, humans = repository
    human_id = await _make_human(humans, "Bob")
    other_id = await _make_human(humans, "Alice")
    ids = []
    for index in range(5):
        job = await store.create(
            portrait_path=f"/{index}.jpg",
            recording_path=f"/{index}.wav",
            digital_human_id=human_id,
        )
        ids.append(job.id)
    await store.create(
        portrait_path="/other.jpg",
        recording_path="/other.wav",
        digital_human_id=other_id,
    )

    all_for_human = await store.list_for_digital_human(human_id)
    assert [job.id for job in all_for_human] == list(reversed(ids))

    page = await store.list_for_digital_human(human_id, limit=2, offset=1)
    assert [job.id for job in page] == list(reversed(ids))[1:3]

    with pytest.raises(ValueError):
        await store.list_for_digital_human(human_id, limit=0)
    with pytest.raises(ValueError):
        await store.list_for_digital_human(human_id, offset=-1)


@pytest.mark.asyncio
async def test_list_for_digital_human_paginates_51_plus_without_duplicates(
    repository,
) -> None:
    """Walking pages of a 51+ job history must not duplicate or drop rows and
    must keep a stable order across pages."""
    _, store, humans = repository
    human_id = await _make_human(humans, "Bob")
    other_id = await _make_human(humans, "Alice")
    ids = []
    for index in range(55):
        job = await store.create(
            portrait_path=f"/{index}.jpg",
            recording_path=f"/{index}.wav",
            digital_human_id=human_id,
        )
        ids.append(job.id)
    # A job for someone else must never leak into this human's pages.
    await store.create(
        portrait_path="/other.jpg",
        recording_path="/other.wav",
        digital_human_id=other_id,
    )

    expected = list(reversed(ids))
    collected: list[str] = []
    offset = 0
    limit = 20
    while True:
        page = await store.list_for_digital_human(
            human_id, limit=limit, offset=offset
        )
        collected.extend(job.id for job in page)
        if len(page) < limit:
            break
        offset += len(page)

    assert len(collected) == 55
    assert collected == expected, (
        "pages must concatenate into the full, ordered history"
    )
    assert len(set(collected)) == 55, "pages must not overlap (no duplicates)"
