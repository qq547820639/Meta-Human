from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from voxstudio_core.providers.verify import (
    PROVIDER_TYPES,
    ProviderVerification,
    ProviderVerifier,
    ProviderVerifyRequest,
)
from voxstudio_core.security import BearerTokenGuard


def create_providers_router(*, guard: BearerTokenGuard) -> APIRouter:
    router = APIRouter(dependencies=[Depends(guard)])

    @router.get(
        "/v1/providers/types",
    )
    async def provider_types() -> dict[str, list[str]]:
        """List the provider types supported by the deep-verification contract."""
        return {"providers": list(PROVIDER_TYPES)}

    @router.post(
        "/v1/providers/verify",
        response_model=ProviderVerification,
    )
    async def verify_provider(
        request: Request,
        body: ProviderVerifyRequest,
    ) -> ProviderVerification:
        """Run a step-by-step deep verification for a single provider type.

        The verification reuses the real HTTP clients for each provider, so the
        result reflects the true provider state and never fabricates success.
        The request's trace id is propagated into the verification result so the
        frontend can correlate failures with server logs.
        """
        trace_id = getattr(request.state, "request_id", None)
        verifier = ProviderVerifier(
            trace_id=trace_id if isinstance(trace_id, str) else None
        )
        return await verifier.verify(body)

    return router
