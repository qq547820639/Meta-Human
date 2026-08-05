from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import pytest
from httpx import ASGITransport, AsyncClient

from voxstudio_core.api.app import create_app
from voxstudio_core.config import SidecarConfig, generate_startup_token


class EmptyLifecycle:
    def __init__(self) -> None:
        self.started = False
        self.stopped = False

    async def startup(self) -> None:
        self.started = True

    async def shutdown(self) -> None:
        self.stopped = True

    async def current_run(self) -> None:
        return None

    async def start_or_resume(self) -> None:
        raise AssertionError("providers routes must not start readiness work")


@asynccontextmanager
async def running_client(
    lifecycle: EmptyLifecycle,
) -> AsyncIterator[AsyncClient]:
    token = generate_startup_token()
    config = SidecarConfig(bearer_token=token)
    app = create_app(config=config, lifecycle=lifecycle)
    async with app.router.lifespan_context(app):
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://sidecar.test",
        ) as client:
            yield client, token


@asynccontextmanager
async def authed_client() -> AsyncIterator[tuple[AsyncClient, str]]:
    async with running_client(EmptyLifecycle()) as (client, token):
        yield client, token


@pytest.mark.asyncio
async def test_provider_types_require_bearer_token_and_list_all_types() -> None:
    async with running_client(EmptyLifecycle()) as (client, token):
        unauth = await client.get("/v1/providers/types")
        auth = await client.get(
            "/v1/providers/types",
            headers={"Authorization": f"Bearer {token}"},
        )

    assert unauth.status_code == 401
    assert auth.status_code == 200
    providers = auth.json()["providers"]
    assert providers == [
        "ollama",
        "lmstudio",
        "remote_gpu",
        "feishu",
        "stt",
        "tts",
        "llm",
    ]


@pytest.mark.asyncio
async def test_verify_unconfigured_feishu_returns_200_unconfigured() -> None:
    async with authed_client() as (client, token):
        response = await client.post(
            "/v1/providers/verify",
            headers={"Authorization": f"Bearer {token}"},
            json={"provider_type": "feishu"},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "unconfigured"
    assert body["current_step"] == "config"
    assert body["error_trace_id"] is not None
    assert "verified_at" in body


@pytest.mark.asyncio
async def test_verify_requires_bearer_token() -> None:
    async with running_client(EmptyLifecycle()) as (client, _):
        response = await client.post(
            "/v1/providers/verify",
            json={"provider_type": "feishu"},
        )

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_verify_rejects_invalid_provider_type_with_422() -> None:
    async with authed_client() as (client, token):
        response = await client.post(
            "/v1/providers/verify",
            headers={"Authorization": f"Bearer {token}"},
            json={"provider_type": "not_a_provider"},
        )

    assert response.status_code == 422
    assert response.json()["code"] == "invalid_request"


@pytest.mark.asyncio
async def test_verify_response_carries_trace_id_and_timestamp() -> None:
    async with authed_client() as (client, token):
        response = await client.post(
            "/v1/providers/verify",
            headers={"Authorization": f"Bearer {token}"},
            json={"provider_type": "feishu"},
        )

    body = response.json()
    assert "error_trace_id" in body
    assert body["verified_at"].endswith("Z")
    assert body["error_trace_id"] == response.headers["x-request-id"]
