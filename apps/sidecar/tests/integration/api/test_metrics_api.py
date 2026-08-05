"""Integration tests for the provider metrics endpoint and privacy of its data."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import pytest
from httpx import ASGITransport, AsyncClient

from voxstudio_core.api.app import create_app
from voxstudio_core.config import SidecarConfig, generate_startup_token
from voxstudio_core.metrics import OUTCOME_ERROR, OUTCOME_SUCCESS, registry


class StaticLifecycle:
    async def startup(self) -> None:
        return None

    async def shutdown(self) -> None:
        return None

    async def current_run(self) -> None:
        return None

    async def start_or_resume(self) -> None:
        return None


@asynccontextmanager
async def running_client(token: str) -> AsyncIterator[AsyncClient]:
    app = create_app(
        config=SidecarConfig(bearer_token=token),
        lifecycle=StaticLifecycle(),
    )
    async with app.router.lifespan_context(app):
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://sidecar.test",
        ) as client:
            yield client


@pytest.mark.asyncio
async def test_provider_metrics_endpoint_requires_auth() -> None:
    async with running_client(generate_startup_token()) as client:
        response = await client.get("/v1/metrics/providers")

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_provider_metrics_endpoint_exposes_counters_only(
) -> None:
    token = generate_startup_token()
    registry.reset()
    registry.record("llm_chat", OUTCOME_SUCCESS, 12.0)
    registry.record("llm_chat", OUTCOME_ERROR, 99.0)

    async with running_client(token) as client:
        response = await client.get(
            "/v1/metrics/providers",
            headers={"Authorization": f"Bearer {token}"},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["total_calls"] == 2
    assert body["total_error_rate"] == 0.5
    assert [row["provider"] for row in body["providers"]] == ["llm_chat"]
    assert body["providers"][0]["success"] == 1
    assert body["providers"][0]["error"] == 1
    assert body["providers"][0]["avg_latency_ms"] is not None
    # The response must never contain any user content.
    assert "transcript" not in response.text
    assert "conversation" not in response.text
    assert "prompt" not in response.text
    assert "secret" not in response.text
    assert "Bearer" not in response.text
    assert token not in response.text
