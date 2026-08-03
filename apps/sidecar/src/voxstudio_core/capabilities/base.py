from dataclasses import dataclass
from typing import Protocol

from voxstudio_core.readiness.models import CapabilityId


@dataclass(frozen=True, slots=True)
class CapabilityCheckRequest:
    capability_id: CapabilityId
    attempt: int


@dataclass(frozen=True, slots=True)
class CapabilityReady:
    safe_detail: str | None = None


@dataclass(frozen=True, slots=True)
class CapabilityTransientFailure:
    code: str
    message: str
    safe_detail: str | None = None


@dataclass(frozen=True, slots=True)
class CapabilityActionRequired:
    code: str
    message: str
    recommended_action: str
    safe_detail: str | None = None

    def __post_init__(self) -> None:
        if not self.recommended_action.strip():
            raise ValueError("recommended_action must not be empty")


type CapabilityCheckOutcome = (
    CapabilityReady | CapabilityTransientFailure | CapabilityActionRequired
)


class CapabilityAdapter(Protocol):
    async def check(
        self,
        request: CapabilityCheckRequest,
    ) -> CapabilityCheckOutcome: ...
