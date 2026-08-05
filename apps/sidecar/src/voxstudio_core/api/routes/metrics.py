from pydantic import BaseModel, ConfigDict

from fastapi import APIRouter, Depends

from voxstudio_core.metrics import registry
from voxstudio_core.security import BearerTokenGuard


class ProviderMetrics(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider: str
    total: int
    success: int
    error: int
    cancelled: int
    degraded: int
    error_rate: float
    cancel_rate: float
    degraded_rate: float
    avg_latency_ms: float | None
    p95_latency_ms: float | None


class ProviderMetricsSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    providers: list[ProviderMetrics]
    total_calls: int
    total_error_rate: float
    total_cancel_rate: float
    total_degraded_rate: float


def create_metrics_router(*, guard: BearerTokenGuard) -> APIRouter:
    router = APIRouter(dependencies=[Depends(guard)])

    @router.get(
        "/v1/metrics/providers",
        response_model=ProviderMetricsSummary,
    )
    async def provider_metrics() -> ProviderMetricsSummary:
        """Aggregated provider observability counters.

        Contains only aggregate counts and latency statistics -- no prompts,
        transcripts, configuration or any user content.
        """
        return ProviderMetricsSummary(**registry.snapshot())

    return router