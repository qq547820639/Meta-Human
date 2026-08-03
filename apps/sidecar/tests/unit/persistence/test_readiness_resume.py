from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
import pytest_asyncio

from voxstudio_core.persistence.database import Database
from voxstudio_core.persistence.readiness_repository import (
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
async def readiness_repository(tmp_path: Path) -> AsyncIterator[ReadinessRepository]:
    database = Database(tmp_path / "resume.sqlite3")
    await database.connect()
    await database.migrate()
    try:
        yield ReadinessRepository(database)
    finally:
        await database.close()


@pytest.mark.asyncio
async def test_resume_rewinds_interrupted_checks_and_keeps_ready_checks(
    readiness_repository: ReadinessRepository,
) -> None:
    created_at = datetime(2026, 8, 1, 13, 0, tzinfo=UTC)
    checking_at = created_at + timedelta(seconds=10)
    resumed_at = created_at + timedelta(minutes=1)
    run = await readiness_repository.create_or_get_current_run(
        [readiness(capability_id) for capability_id in CapabilityId],
        run_id="run-interrupted",
        created_at=created_at,
    )
    await readiness_repository.update_capabilities(
        run.id,
        (
            CapabilityUpdate(
                id=CapabilityId.LLM_CHAT,
                state=CapabilityState.READY,
                attempts=1,
                safe_detail="Conversation check passed.",
            ),
            CapabilityUpdate(
                id=CapabilityId.STT_TRANSCRIBE,
                state=CapabilityState.CHECKING,
                attempts=2,
                safe_detail="Checking microphone path.",
                error=SafeError(
                    code="transient_probe_error",
                    message="The previous probe will be retried.",
                    retryable=True,
                ),
            ),
        ),
        state=AggregateState.CHECKING,
        updated_at=checking_at,
    )

    resumed = await readiness_repository.resume_latest_incomplete_run(
        resumed_at=resumed_at
    )

    assert resumed is not None
    assert resumed.id == run.id
    assert resumed.state is AggregateState.RECOVERING
    assert resumed.updated_at == resumed_at
    capabilities = {item.id: item for item in resumed.capabilities}
    assert capabilities[CapabilityId.LLM_CHAT].state is CapabilityState.READY
    assert capabilities[CapabilityId.LLM_CHAT].attempts == 1
    assert capabilities[CapabilityId.LLM_CHAT].safe_detail == (
        "Conversation check passed."
    )
    assert capabilities[CapabilityId.LLM_CHAT].updated_at == checking_at
    assert capabilities[CapabilityId.STT_TRANSCRIBE].state is CapabilityState.PENDING
    assert capabilities[CapabilityId.STT_TRANSCRIBE].attempts == 2
    assert capabilities[CapabilityId.STT_TRANSCRIBE].safe_detail is None
    assert capabilities[CapabilityId.STT_TRANSCRIBE].error is None
    assert capabilities[CapabilityId.STT_TRANSCRIBE].updated_at == resumed_at


@pytest.mark.asyncio
async def test_resume_selects_the_incomplete_run_and_preserves_completed_history(
    readiness_repository: ReadinessRepository,
) -> None:
    created_at = datetime(2026, 8, 1, 14, 0, tzinfo=UTC)
    ready_capabilities = [
        readiness(capability_id, CapabilityState.READY)
        for capability_id in CapabilityId
    ]
    completed = await readiness_repository.create_or_get_current_run(
        ready_capabilities,
        run_id="run-history",
        created_at=created_at,
    )
    completed = await readiness_repository.complete_run(
        completed.id,
        state=AggregateState.READY,
        completed_at=created_at + timedelta(minutes=1),
    )
    active = await readiness_repository.create_or_get_current_run(
        [readiness(capability_id) for capability_id in CapabilityId],
        run_id="run-active",
        created_at=created_at + timedelta(minutes=2),
    )
    await readiness_repository.update_capabilities(
        active.id,
        (
            CapabilityUpdate(
                id=CapabilityId.AVATAR_STREAM,
                state=CapabilityState.CHECKING,
                attempts=1,
            ),
        ),
        state=AggregateState.CHECKING,
        updated_at=created_at + timedelta(minutes=3),
    )

    resumed = await readiness_repository.resume_latest_incomplete_run(
        resumed_at=created_at + timedelta(minutes=4)
    )
    loaded_history = await readiness_repository.load_run(completed.id)

    assert resumed is not None
    assert resumed.id == active.id
    assert loaded_history == completed
    assert loaded_history is not None
    assert loaded_history.state is AggregateState.READY
    assert all(
        capability.state is CapabilityState.READY
        for capability in loaded_history.capabilities
    )


@pytest.mark.asyncio
async def test_resume_returns_none_when_every_run_is_complete(
    readiness_repository: ReadinessRepository,
) -> None:
    created_at = datetime(2026, 8, 1, 15, 0, tzinfo=UTC)
    run = await readiness_repository.create_or_get_current_run(
        [
            readiness(capability_id, CapabilityState.READY)
            for capability_id in CapabilityId
        ],
        run_id="run-finished",
        created_at=created_at,
    )
    await readiness_repository.complete_run(
        run.id,
        state=AggregateState.READY,
        completed_at=created_at + timedelta(minutes=1),
    )

    resumed = await readiness_repository.resume_latest_incomplete_run(
        resumed_at=created_at + timedelta(minutes=2)
    )

    assert resumed is None
