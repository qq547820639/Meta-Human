from collections.abc import Iterable

import pytest
from pydantic import ValidationError

from voxstudio_core.readiness.models import (
    AggregateState,
    CapabilityId,
    CapabilityReadiness,
    CapabilityState,
    OutcomeId,
    aggregate_state,
    gate_open,
    group_outcomes,
)


def capability(
    capability_id: CapabilityId,
    state: CapabilityState = CapabilityState.READY,
    *,
    required: bool = True,
) -> CapabilityReadiness:
    return CapabilityReadiness(id=capability_id, required=required, state=state)


def all_capabilities(
    state: CapabilityState = CapabilityState.READY,
) -> list[CapabilityReadiness]:
    return [capability(capability_id, state) for capability_id in CapabilityId]


def test_capability_ids_are_exact() -> None:
    assert tuple(item.value for item in CapabilityId) == (
        "llm.chat",
        "embedding.text",
        "stt.transcribe",
        "tts.synthesize",
        "voice.enroll",
        "avatar.enroll",
        "avatar.stream",
    )


def test_capability_states_are_exact() -> None:
    assert tuple(item.value for item in CapabilityState) == (
        "pending",
        "checking",
        "ready",
        "degraded",
        "action_required",
        "failed",
    )


def test_aggregate_states_include_lifecycle_states() -> None:
    assert set(item.value for item in AggregateState) == {
        "not_started",
        "pending",
        "checking",
        "ready",
        "degraded",
        "action_required",
        "failed",
        "recovering",
        "stopping",
    }


def test_outcome_ids_are_exact() -> None:
    assert tuple(item.value for item in OutcomeId) == (
        "conversation",
        "voicePresence",
        "knowledge",
    )


def test_models_serialize_enums_to_wire_values() -> None:
    readiness = capability(CapabilityId.LLM_CHAT, CapabilityState.ACTION_REQUIRED)

    assert readiness.model_dump(mode="json") == {
        "id": "llm.chat",
        "required": True,
        "state": "action_required",
    }


def test_invalid_capability_id_is_rejected() -> None:
    with pytest.raises(ValidationError):
        CapabilityReadiness(id="llm.complete", required=True, state="ready")


def test_invalid_capability_state_is_rejected() -> None:
    with pytest.raises(ValidationError):
        CapabilityReadiness(id="llm.chat", required=True, state="unknown")


@pytest.mark.parametrize(
    ("states", "expected"),
    [
        ((), AggregateState.NOT_STARTED),
        ((CapabilityState.PENDING,), AggregateState.NOT_STARTED),
        ((CapabilityState.READY,), AggregateState.READY),
        (
            (CapabilityState.READY, CapabilityState.PENDING),
            AggregateState.PENDING,
        ),
        (
            (CapabilityState.PENDING, CapabilityState.CHECKING),
            AggregateState.CHECKING,
        ),
        (
            (CapabilityState.CHECKING, CapabilityState.DEGRADED),
            AggregateState.DEGRADED,
        ),
        (
            (CapabilityState.DEGRADED, CapabilityState.ACTION_REQUIRED),
            AggregateState.ACTION_REQUIRED,
        ),
        (
            (CapabilityState.ACTION_REQUIRED, CapabilityState.FAILED),
            AggregateState.FAILED,
        ),
    ],
)
def test_aggregate_state_uses_fail_safe_precedence(
    states: Iterable[CapabilityState],
    expected: AggregateState,
) -> None:
    states = tuple(states)

    assert aggregate_state(states) is expected
    assert aggregate_state(reversed(states)) is expected


def test_capabilities_group_into_user_facing_outcomes() -> None:
    readiness = all_capabilities()
    readiness[1] = capability(
        CapabilityId.EMBEDDING_TEXT,
        CapabilityState.ACTION_REQUIRED,
    )
    readiness[2] = capability(CapabilityId.STT_TRANSCRIBE, CapabilityState.CHECKING)

    outcomes = group_outcomes(readiness)

    assert tuple(outcome.id for outcome in outcomes) == (
        OutcomeId.CONVERSATION,
        OutcomeId.VOICE_PRESENCE,
        OutcomeId.KNOWLEDGE,
    )
    assert {
        outcome.id: tuple(item.id for item in outcome.capabilities)
        for outcome in outcomes
    } == {
        OutcomeId.CONVERSATION: (CapabilityId.LLM_CHAT,),
        OutcomeId.VOICE_PRESENCE: (
            CapabilityId.STT_TRANSCRIBE,
            CapabilityId.TTS_SYNTHESIZE,
            CapabilityId.VOICE_ENROLL,
            CapabilityId.AVATAR_ENROLL,
            CapabilityId.AVATAR_STREAM,
        ),
        OutcomeId.KNOWLEDGE: (CapabilityId.EMBEDDING_TEXT,),
    }
    assert {outcome.id: outcome.state for outcome in outcomes} == {
        OutcomeId.CONVERSATION: AggregateState.READY,
        OutcomeId.VOICE_PRESENCE: AggregateState.CHECKING,
        OutcomeId.KNOWLEDGE: AggregateState.ACTION_REQUIRED,
    }
    assert all(outcome.required for outcome in outcomes)


def test_missing_capabilities_keep_their_outcomes_required_and_not_started() -> None:
    outcomes = {
        outcome.id: outcome
        for outcome in group_outcomes([capability(CapabilityId.LLM_CHAT)])
    }

    for outcome_id in (OutcomeId.VOICE_PRESENCE, OutcomeId.KNOWLEDGE):
        assert outcomes[outcome_id].required is True
        assert outcomes[outcome_id].state is AggregateState.NOT_STARTED


def test_gate_is_closed_without_required_capabilities() -> None:
    assert gate_open([]) is False


def test_gate_is_closed_when_known_required_capabilities_are_missing() -> None:
    readiness = [capability(CapabilityId.LLM_CHAT)]

    assert gate_open(readiness) is False


@pytest.mark.parametrize(
    "state",
    [state for state in CapabilityState if state is not CapabilityState.READY],
)
def test_gate_is_closed_when_any_required_capability_is_not_ready(
    state: CapabilityState,
) -> None:
    readiness = all_capabilities()
    readiness[-1] = capability(CapabilityId.AVATAR_STREAM, state)

    assert gate_open(readiness) is False


def test_gate_is_open_when_every_required_capability_is_ready() -> None:
    assert gate_open(all_capabilities()) is True


def test_non_required_capabilities_do_not_close_the_gate() -> None:
    readiness = all_capabilities()
    readiness[-1] = capability(
        CapabilityId.AVATAR_STREAM,
        CapabilityState.FAILED,
        required=False,
    )

    assert gate_open(readiness) is True
