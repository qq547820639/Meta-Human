from collections.abc import Mapping

from voxstudio_core.capabilities.base import CapabilityAdapter
from voxstudio_core.readiness.models import CapabilityId


class AdapterNotRegisteredError(LookupError):
    pass


class CapabilityAdapterRegistry:
    def __init__(
        self,
        adapters: Mapping[CapabilityId, CapabilityAdapter],
    ) -> None:
        self._adapters = dict(adapters)

    def adapter_for(self, capability_id: CapabilityId) -> CapabilityAdapter:
        try:
            return self._adapters[capability_id]
        except KeyError as error:
            raise AdapterNotRegisteredError(capability_id.value) from error
