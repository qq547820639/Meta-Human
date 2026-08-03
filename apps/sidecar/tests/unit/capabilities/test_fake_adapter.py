import pytest

from voxstudio_core.capabilities.base import (
    CapabilityActionRequired,
    CapabilityCheckRequest,
    CapabilityReady,
    CapabilityTransientFailure,
)
from voxstudio_core.capabilities.fake import (
    FakeCapabilityAdapter,
    ScriptedOutcomeExhaustedError,
)
from voxstudio_core.capabilities.registry import (
    AdapterNotRegisteredError,
    CapabilityAdapterRegistry,
)
from voxstudio_core.readiness.models import CapabilityId


@pytest.mark.asyncio
async def test_fake_adapter_consumes_typed_outcomes_in_order_and_records_calls(
) -> None:
    ready = CapabilityReady(safe_detail="Conversation check passed.")
    transient_failure = CapabilityTransientFailure(
        code="temporarily_unavailable",
        message="The capability is temporarily unavailable.",
        safe_detail="The check can be resumed.",
    )
    adapter = FakeCapabilityAdapter([ready, transient_failure])
    first_request = CapabilityCheckRequest(
        capability_id=CapabilityId.LLM_CHAT,
        attempt=1,
    )
    second_request = CapabilityCheckRequest(
        capability_id=CapabilityId.LLM_CHAT,
        attempt=2,
    )

    assert await adapter.check(first_request) == ready
    assert await adapter.check(second_request) == transient_failure
    assert adapter.calls == (first_request, second_request)


@pytest.mark.asyncio
async def test_fake_adapter_fails_clearly_when_script_is_over_consumed() -> None:
    adapter = FakeCapabilityAdapter([])
    request = CapabilityCheckRequest(
        capability_id=CapabilityId.EMBEDDING_TEXT,
        attempt=3,
    )

    with pytest.raises(
        ScriptedOutcomeExhaustedError,
        match=r"embedding\.text.*attempt 3",
    ):
        await adapter.check(request)

    assert adapter.calls == (request,)


def test_action_required_outcome_requires_one_recommended_action() -> None:
    with pytest.raises(ValueError, match="recommended_action"):
        CapabilityActionRequired(
            code="microphone_permission_required",
            message="Microphone access is required.",
            recommended_action="  ",
        )


def test_registry_resolves_injected_adapters_by_capability() -> None:
    adapter = FakeCapabilityAdapter([CapabilityReady()])
    registry = CapabilityAdapterRegistry({CapabilityId.LLM_CHAT: adapter})

    assert registry.adapter_for(CapabilityId.LLM_CHAT) is adapter


def test_registry_fails_clearly_for_an_unregistered_capability() -> None:
    registry = CapabilityAdapterRegistry({})

    with pytest.raises(AdapterNotRegisteredError, match=r"avatar\.stream"):
        registry.adapter_for(CapabilityId.AVATAR_STREAM)
