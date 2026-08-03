from collections import deque
from collections.abc import Iterable

from voxstudio_core.capabilities.base import (
    CapabilityCheckOutcome,
    CapabilityCheckRequest,
)


class ScriptedOutcomeExhaustedError(RuntimeError):
    pass


class FakeCapabilityAdapter:
    def __init__(self, outcomes: Iterable[CapabilityCheckOutcome]) -> None:
        self._outcomes = deque(outcomes)
        self._calls: list[CapabilityCheckRequest] = []

    @property
    def calls(self) -> tuple[CapabilityCheckRequest, ...]:
        return tuple(self._calls)

    async def check(
        self,
        request: CapabilityCheckRequest,
    ) -> CapabilityCheckOutcome:
        self._calls.append(request)
        try:
            return self._outcomes.popleft()
        except IndexError as error:
            raise ScriptedOutcomeExhaustedError(
                "No scripted outcome remains for "
                f"{request.capability_id.value} attempt {request.attempt}."
            ) from error
