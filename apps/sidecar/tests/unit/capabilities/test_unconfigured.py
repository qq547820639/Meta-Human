import pytest

from voxstudio_core.capabilities.base import (
    CapabilityActionRequired,
    CapabilityCheckRequest,
)
from voxstudio_core.capabilities.unconfigured import (
    UnconfiguredCapabilityAdapter,
)
from voxstudio_core.readiness.models import CapabilityId


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "capability_id",
    [capability for capability in CapabilityId],
)
async def test_unconfigured_adapter_requires_user_action(
    capability_id: CapabilityId,
) -> None:
    outcome = await UnconfiguredCapabilityAdapter(capability_id).check(
        CapabilityCheckRequest(capability_id=capability_id, attempt=1)
    )

    assert isinstance(outcome, CapabilityActionRequired)
    assert outcome.code == "provider_not_configured"
    assert outcome.recommended_action.strip()
