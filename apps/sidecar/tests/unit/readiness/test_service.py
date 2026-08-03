from collections.abc import AsyncIterator
from datetime import UTC, datetime
from pathlib import Path

import pytest
import pytest_asyncio

from voxstudio_core.capabilities.base import (
    CapabilityActionRequired,
    CapabilityAdapter,
    CapabilityCheckOutcome,
    CapabilityCheckRequest,
    CapabilityReady,
    CapabilityTransientFailure,
)
from voxstudio_core.capabilities.fake import FakeCapabilityAdapter
from voxstudio_core.capabilities.registry import CapabilityAdapterRegistry
from voxstudio_core.persistence.database import Database
from voxstudio_core.persistence.readiness_repository import (
    CapabilityUpdate,
    ReadinessRepository,
)
from voxstudio_core.readiness.models import (
    AggregateState,
    CapabilityId,
    CapabilityReadiness,
    CapabilityState,
    gate_open,
)
from voxstudio_core.readiness.service import ReadinessService


class InspectingAdapter:
    def __init__(self, repository: ReadinessRepository) -> None:
        self._repository = repository
        self.observed_states: list[
            tuple[AggregateState, CapabilityState, int]
        ] = []

    async def check(
        self,
        request: CapabilityCheckRequest,
    ) -> CapabilityCheckOutcome:
        run = await self._repository.load_current_run()
        assert run is not None
        capability = next(
            item for item in run.capabilities if item.id is request.capability_id
        )
        self.observed_states.append(
            (run.state, capability.state, capability.attempts)
        )
        return CapabilityReady(safe_detail="Conversation check passed.")


@pytest_asyncio.fixture
async def repository(tmp_path: Path) -> AsyncIterator[ReadinessRepository]:
    database = Database(tmp_path / "service.sqlite3")
    await database.connect()
    await database.migrate()
    try:
        yield ReadinessRepository(database)
    finally:
        await database.close()


def ready_adapters(
    overrides: dict[CapabilityId, CapabilityAdapter] | None = None,
) -> dict[CapabilityId, CapabilityAdapter]:
    adapters: dict[CapabilityId, CapabilityAdapter] = {
        capability_id: FakeCapabilityAdapter(
            [CapabilityReady(safe_detail="Capability check passed.")]
        )
        for capability_id in CapabilityId
    }
    adapters.update(overrides or {})
    return adapters


def pending_capabilities() -> list[CapabilityReadiness]:
    return [
        CapabilityReadiness(
            id=capability_id,
            required=True,
            state=CapabilityState.PENDING,
        )
        for capability_id in CapabilityId
    ]


@pytest.mark.asyncio
async def test_service_persists_checking_before_invocation_and_ready_afterward(
    repository: ReadinessRepository,
) -> None:
    inspecting_adapter = InspectingAdapter(repository)
    service = ReadinessService(
        repository=repository,
        registry=CapabilityAdapterRegistry(
            ready_adapters({CapabilityId.LLM_CHAT: inspecting_adapter})
        ),
    )

    result = await service.prepare()

    assert inspecting_adapter.observed_states == [
        (AggregateState.CHECKING, CapabilityState.CHECKING, 1)
    ]
    conversation = next(
        item for item in result.capabilities if item.id is CapabilityId.LLM_CHAT
    )
    assert conversation.state is CapabilityState.READY
    assert conversation.attempts == 1
    assert conversation.safe_detail == "Conversation check passed."
    assert result.state is AggregateState.READY


@pytest.mark.asyncio
async def test_service_skips_optional_capabilities_and_opens_gate(
    repository: ReadinessRepository,
) -> None:
    required = frozenset(
        {
            CapabilityId.LLM_CHAT,
            CapabilityId.EMBEDDING_TEXT,
            CapabilityId.STT_TRANSCRIBE,
        }
    )
    service = ReadinessService(
        repository=repository,
        registry=CapabilityAdapterRegistry(ready_adapters()),
        required_capability_ids=required,
    )

    result = await service.prepare()

    assert result.state is AggregateState.READY
    assert gate_open(result.capabilities) is True
    voice = next(
        capability
        for capability in result.capabilities
        if capability.id is CapabilityId.VOICE_ENROLL
    )
    assert voice.required is False
    assert voice.state is CapabilityState.PENDING


@pytest.mark.asyncio
async def test_service_skips_capabilities_that_are_already_ready_on_resume(
    repository: ReadinessRepository,
) -> None:
    created_at = datetime(2026, 8, 1, 8, 0, tzinfo=UTC)
    run = await repository.create_or_get_current_run(
        pending_capabilities(),
        run_id="resume-ready",
        created_at=created_at,
    )
    await repository.update_capabilities(
        run.id,
        (
            CapabilityUpdate(
                id=CapabilityId.LLM_CHAT,
                state=CapabilityState.READY,
                attempts=1,
                safe_detail="Conversation check passed earlier.",
            ),
        ),
        state=AggregateState.PENDING,
        updated_at=created_at,
    )
    skipped_adapter = FakeCapabilityAdapter([])
    service = ReadinessService(
        repository=repository,
        registry=CapabilityAdapterRegistry(
            ready_adapters({CapabilityId.LLM_CHAT: skipped_adapter})
        ),
    )

    result = await service.prepare()

    conversation = next(
        item for item in result.capabilities if item.id is CapabilityId.LLM_CHAT
    )
    assert skipped_adapter.calls == ()
    assert conversation.state is CapabilityState.READY
    assert conversation.attempts == 1
    assert conversation.safe_detail == "Conversation check passed earlier."


@pytest.mark.asyncio
async def test_service_maps_transient_failure_to_recoverable_degraded_state(
    repository: ReadinessRepository,
) -> None:
    transient_adapter = FakeCapabilityAdapter(
        [
            CapabilityTransientFailure(
                code="model_starting",
                message="The conversation engine is still starting.",
                safe_detail="Conversation is recovering automatically.",
            )
        ]
    )
    service = ReadinessService(
        repository=repository,
        registry=CapabilityAdapterRegistry(
            ready_adapters({CapabilityId.LLM_CHAT: transient_adapter})
        ),
    )

    result = await service.prepare()

    conversation = next(
        item for item in result.capabilities if item.id is CapabilityId.LLM_CHAT
    )
    assert conversation.state is CapabilityState.DEGRADED
    assert conversation.attempts == 1
    assert conversation.safe_detail == "Conversation is recovering automatically."
    assert conversation.error is not None
    assert conversation.error.code == "model_starting"
    assert conversation.error.retryable is True
    assert conversation.error.recommended_action is None
    assert result.state is AggregateState.DEGRADED
    assert len(transient_adapter.calls) == 1


@pytest.mark.asyncio
async def test_service_maps_user_remediable_failure_to_one_safe_action(
    repository: ReadinessRepository,
) -> None:
    action_adapter = FakeCapabilityAdapter(
        [
            CapabilityActionRequired(
                code="microphone_permission_required",
                message="Microphone access is required for voice enrollment.",
                recommended_action="Allow microphone access in System Settings.",
                safe_detail="Voice enrollment needs your permission.",
            )
        ]
    )
    service = ReadinessService(
        repository=repository,
        registry=CapabilityAdapterRegistry(
            ready_adapters({CapabilityId.VOICE_ENROLL: action_adapter})
        ),
    )

    result = await service.prepare()

    voice_enrollment = next(
        item
        for item in result.capabilities
        if item.id is CapabilityId.VOICE_ENROLL
    )
    assert voice_enrollment.state is CapabilityState.ACTION_REQUIRED
    assert voice_enrollment.attempts == 1
    assert voice_enrollment.error is not None
    assert voice_enrollment.error.retryable is False
    assert voice_enrollment.error.recommended_action == (
        "Allow microphone access in System Settings."
    )
    assert result.state is AggregateState.ACTION_REQUIRED
