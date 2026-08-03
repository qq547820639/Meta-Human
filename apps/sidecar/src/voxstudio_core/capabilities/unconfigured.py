from voxstudio_core.capabilities.base import (
    CapabilityActionRequired,
    CapabilityCheckOutcome,
    CapabilityCheckRequest,
)
from voxstudio_core.readiness.models import CapabilityId


_CAPABILITY_LABELS: dict[CapabilityId, str] = {
    CapabilityId.LLM_CHAT: "local chat model",
    CapabilityId.EMBEDDING_TEXT: "knowledge embedding service",
    CapabilityId.STT_TRANSCRIBE: "local speech recognition model",
    CapabilityId.TTS_SYNTHESIZE: "remote TTS service",
    CapabilityId.VOICE_ENROLL: "remote voice service",
    CapabilityId.AVATAR_ENROLL: "remote avatar service",
    CapabilityId.AVATAR_STREAM: "remote avatar stream service",
}


class UnconfiguredCapabilityAdapter:
    def __init__(self, capability_id: CapabilityId) -> None:
        self._capability_id = capability_id
        self._label = _CAPABILITY_LABELS[capability_id]

    async def check(
        self,
        request: CapabilityCheckRequest,
    ) -> CapabilityCheckOutcome:
        del request
        return CapabilityActionRequired(
            code="provider_not_configured",
            message=f"The {self._label} is not configured.",
            recommended_action=(
                "Configure the provider in Settings and try again."
            ),
            safe_detail=(
                f"{self._label} readiness has no configured provider."
            ),
        )
