from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import aiosqlite
import pytest
import pytest_asyncio

from voxstudio_core.persistence.database import Database
from voxstudio_core.persistence.readiness_repository import (
    CapabilityNotFoundError,
    CapabilityUpdate,
    ReadinessRepository,
    SafeError,
)
from voxstudio_core.readiness.models import (
    AggregateState,
    CapabilityId,
    CapabilityReadiness,
    CapabilityState,
)


def readiness(
    capability_id: CapabilityId,
    state: CapabilityState = CapabilityState.PENDING,
) -> CapabilityReadiness:
    return CapabilityReadiness(id=capability_id, required=True, state=state)


@pytest_asyncio.fixture
async def repository(
    tmp_path: Path,
) -> AsyncIterator[tuple[Database, ReadinessRepository, Path]]:
    database_path = tmp_path / "readiness.sqlite3"
    database = Database(database_path)
    await database.connect()
    await database.migrate()
    try:
        yield database, ReadinessRepository(database), database_path
    finally:
        await database.close()


@pytest.mark.asyncio
async def test_migrations_are_versioned_and_idempotent(tmp_path: Path) -> None:
    database_path = tmp_path / "migrations.sqlite3"
    database = Database(database_path)
    await database.connect()
    try:
        await database.migrate()
        await database.migrate()

        assert await database.applied_migration_versions() == (
            1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
        )
    finally:
        await database.close()

    async with aiosqlite.connect(database_path) as connection:
        async with connection.execute("PRAGMA user_version") as cursor:
            user_version = (await cursor.fetchone())[0]
        async with connection.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
        ) as cursor:
            table_names = {row[0] for row in await cursor.fetchall()}

    assert user_version == 12
    assert {
        "schema_migrations",
        "readiness_runs",
        "readiness_capabilities",
        "readiness_errors",
        "knowledge_documents",
        "knowledge_chunks",
        "conversation_messages",
        "conversation_memory",
        "conversations",
        "memory_entries",
    }.issubset(table_names)


@pytest.mark.asyncio
async def test_create_update_and_load_preserve_safe_status_data_in_stable_order(
    repository: tuple[Database, ReadinessRepository, Path],
) -> None:
    _, readiness_repository, _ = repository
    created_at = datetime(2026, 8, 1, 8, 0, tzinfo=UTC)
    updated_at = created_at + timedelta(seconds=30)

    created = await readiness_repository.create_or_get_current_run(
        [readiness(capability_id) for capability_id in reversed(tuple(CapabilityId))],
        run_id="run-1",
        created_at=created_at,
    )
    await readiness_repository.update_capabilities(
        created.id,
        (
            CapabilityUpdate(
                id=CapabilityId.EMBEDDING_TEXT,
                state=CapabilityState.ACTION_REQUIRED,
                attempts=2,
                safe_detail="Knowledge access needs attention.",
                error=SafeError(
                    code="knowledge_authorization_required",
                    message="Knowledge authorization is required.",
                    retryable=False,
                    recommended_action="Authorize knowledge access.",
                ),
            ),
            CapabilityUpdate(
                id=CapabilityId.LLM_CHAT,
                state=CapabilityState.READY,
                attempts=1,
                safe_detail="Conversation check passed.",
            ),
        ),
        state=AggregateState.ACTION_REQUIRED,
        updated_at=updated_at,
    )

    loaded = await readiness_repository.load_run(created.id)

    assert loaded is not None
    assert loaded.id == "run-1"
    assert loaded.state is AggregateState.ACTION_REQUIRED
    assert loaded.created_at == created_at
    assert loaded.updated_at == updated_at
    assert loaded.completed_at is None
    assert tuple(item.id for item in loaded.capabilities) == tuple(CapabilityId)
    assert loaded.capabilities[0].state is CapabilityState.READY
    assert loaded.capabilities[0].attempts == 1
    assert loaded.capabilities[0].safe_detail == "Conversation check passed."
    assert loaded.capabilities[0].error is None
    assert loaded.capabilities[1].state is CapabilityState.ACTION_REQUIRED
    assert loaded.capabilities[1].attempts == 2
    assert loaded.capabilities[1].error == SafeError(
        code="knowledge_authorization_required",
        message="Knowledge authorization is required.",
        retryable=False,
        recommended_action="Authorize knowledge access.",
    )


@pytest.mark.asyncio
async def test_failed_batch_update_rolls_back_run_and_capability_changes(
    repository: tuple[Database, ReadinessRepository, Path],
) -> None:
    _, readiness_repository, _ = repository
    created_at = datetime(2026, 8, 1, 9, 0, tzinfo=UTC)
    created = await readiness_repository.create_or_get_current_run(
        [
            readiness(CapabilityId.LLM_CHAT),
            readiness(CapabilityId.EMBEDDING_TEXT),
        ],
        run_id="run-rollback",
        created_at=created_at,
    )

    with pytest.raises(CapabilityNotFoundError):
        await readiness_repository.update_capabilities(
            created.id,
            (
                CapabilityUpdate(
                    id=CapabilityId.LLM_CHAT,
                    state=CapabilityState.READY,
                    attempts=1,
                    safe_detail="This write must roll back.",
                ),
                CapabilityUpdate(
                    id=CapabilityId.STT_TRANSCRIBE,
                    state=CapabilityState.READY,
                    attempts=1,
                ),
            ),
            state=AggregateState.READY,
            updated_at=created_at + timedelta(minutes=1),
        )

    loaded = await readiness_repository.load_run(created.id)

    assert loaded is not None
    assert loaded.state is AggregateState.PENDING
    assert loaded.updated_at == created_at
    assert loaded.capabilities[0].state is CapabilityState.PENDING
    assert loaded.capabilities[0].attempts == 0
    assert loaded.capabilities[0].safe_detail is None


@pytest.mark.asyncio
async def test_create_rejects_duplicate_capabilities_without_leaving_a_run(
    repository: tuple[Database, ReadinessRepository, Path],
) -> None:
    _, readiness_repository, _ = repository
    now = datetime(2026, 8, 1, 10, 0, tzinfo=UTC)

    with pytest.raises(ValueError, match="duplicate capability"):
        await readiness_repository.create_or_get_current_run(
            [
                readiness(CapabilityId.LLM_CHAT),
                readiness(CapabilityId.LLM_CHAT),
            ],
            run_id="run-invalid",
            created_at=now,
        )

    assert await readiness_repository.load_current_run() is None


@pytest.mark.asyncio
async def test_create_returns_the_existing_current_run_instead_of_duplicating_it(
    repository: tuple[Database, ReadinessRepository, Path],
) -> None:
    _, readiness_repository, database_path = repository
    created_at = datetime(2026, 8, 1, 11, 0, tzinfo=UTC)
    capabilities = [readiness(capability_id) for capability_id in CapabilityId]

    first = await readiness_repository.create_or_get_current_run(
        capabilities,
        run_id="run-current",
        created_at=created_at,
    )
    second = await readiness_repository.create_or_get_current_run(
        capabilities,
        run_id="run-duplicate-request",
        created_at=created_at + timedelta(seconds=1),
    )

    async with aiosqlite.connect(database_path) as connection:
        async with connection.execute(
            "SELECT COUNT(*) FROM readiness_runs WHERE completed_at IS NULL"
        ) as cursor:
            incomplete_count = (await cursor.fetchone())[0]

    assert second == first
    assert incomplete_count == 1


@pytest.mark.asyncio
async def test_completing_the_current_run_allows_a_new_current_run(
    repository: tuple[Database, ReadinessRepository, Path],
) -> None:
    _, readiness_repository, _ = repository
    created_at = datetime(2026, 8, 1, 12, 0, tzinfo=UTC)
    capabilities = [
        readiness(capability_id, CapabilityState.READY)
        for capability_id in CapabilityId
    ]
    first = await readiness_repository.create_or_get_current_run(
        capabilities,
        run_id="run-complete",
        created_at=created_at,
    )
    await readiness_repository.complete_run(
        first.id,
        state=AggregateState.READY,
        completed_at=created_at + timedelta(minutes=1),
    )

    second = await readiness_repository.create_or_get_current_run(
        capabilities,
        run_id="run-next",
        created_at=created_at + timedelta(minutes=2),
    )

    assert second.id == "run-next"
    assert (await readiness_repository.load_current_run()) == second
