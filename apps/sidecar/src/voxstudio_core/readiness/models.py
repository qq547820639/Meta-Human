from collections.abc import Iterable, Mapping
from enum import StrEnum

from pydantic import BaseModel


class CapabilityId(StrEnum):
    LLM_CHAT = "llm.chat"
    EMBEDDING_TEXT = "embedding.text"
    STT_TRANSCRIBE = "stt.transcribe"
    TTS_SYNTHESIZE = "tts.synthesize"
    VOICE_ENROLL = "voice.enroll"
    AVATAR_ENROLL = "avatar.enroll"
    AVATAR_STREAM = "avatar.stream"


class CapabilityState(StrEnum):
    PENDING = "pending"
    CHECKING = "checking"
    READY = "ready"
    DEGRADED = "degraded"
    ACTION_REQUIRED = "action_required"
    FAILED = "failed"


class AggregateState(StrEnum):
    NOT_STARTED = "not_started"
    PENDING = "pending"
    CHECKING = "checking"
    READY = "ready"
    DEGRADED = "degraded"
    ACTION_REQUIRED = "action_required"
    FAILED = "failed"
    RECOVERING = "recovering"
    STOPPING = "stopping"


class OutcomeId(StrEnum):
    CONVERSATION = "conversation"
    VOICE_PRESENCE = "voicePresence"
    KNOWLEDGE = "knowledge"


class CapabilityReadiness(BaseModel):
    id: CapabilityId
    required: bool = True
    state: CapabilityState


class OutcomeReadiness(BaseModel):
    id: OutcomeId
    required: bool
    state: AggregateState
    capabilities: tuple[CapabilityReadiness, ...]


CAPABILITY_GROUPS: Mapping[OutcomeId, tuple[CapabilityId, ...]] = {
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

REQUIRED_CAPABILITY_IDS: frozenset[CapabilityId] = frozenset(CapabilityId)

_CAPABILITY_STATE_PRECEDENCE = (
    CapabilityState.FAILED,
    CapabilityState.ACTION_REQUIRED,
    CapabilityState.DEGRADED,
    CapabilityState.CHECKING,
    CapabilityState.PENDING,
    CapabilityState.READY,
)


def aggregate_state(states: Iterable[CapabilityState]) -> AggregateState:
    collected_states = tuple(states)
    if not collected_states or all(
        state is CapabilityState.PENDING for state in collected_states
    ):
        return AggregateState.NOT_STARTED

    for state in _CAPABILITY_STATE_PRECEDENCE:
        if state in collected_states:
            return AggregateState(state.value)

    raise ValueError("aggregate_state requires valid capability states")


def group_outcomes(
    capabilities: Iterable[CapabilityReadiness],
) -> tuple[OutcomeReadiness, ...]:
    capabilities_by_id: dict[CapabilityId, CapabilityReadiness] = {}
    for readiness in capabilities:
        if readiness.id in capabilities_by_id:
            raise ValueError(f"duplicate capability: {readiness.id.value}")
        capabilities_by_id[readiness.id] = readiness

    outcomes: list[OutcomeReadiness] = []
    for outcome_id, capability_ids in CAPABILITY_GROUPS.items():
        grouped_capabilities = tuple(
            capabilities_by_id[capability_id]
            for capability_id in capability_ids
            if capability_id in capabilities_by_id
        )
        required_capability_ids = tuple(
            capability_id
            for capability_id in capability_ids
            if capability_id in REQUIRED_CAPABILITY_IDS
            and (
                capability_id not in capabilities_by_id
                or capabilities_by_id[capability_id].required
            )
        )
        outcomes.append(
            OutcomeReadiness(
                id=outcome_id,
                required=bool(required_capability_ids),
                state=aggregate_state(
                    capabilities_by_id[capability_id].state
                    if capability_id in capabilities_by_id
                    else CapabilityState.PENDING
                    for capability_id in required_capability_ids
                ),
                capabilities=grouped_capabilities,
            )
        )

    return tuple(outcomes)


def gate_open(capabilities: Iterable[CapabilityReadiness]) -> bool:
    capabilities = tuple(capabilities)
    if not REQUIRED_CAPABILITY_IDS.issubset(
        readiness.id for readiness in capabilities
    ):
        return False

    required_capabilities = tuple(
        readiness for readiness in capabilities if readiness.required
    )
    return bool(required_capabilities) and all(
        readiness.state is CapabilityState.READY
        for readiness in required_capabilities
    )
