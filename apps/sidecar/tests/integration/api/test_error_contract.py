import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import pytest
from httpx import ASGITransport, AsyncClient

from voxstudio_core.api.app import create_app
from voxstudio_core.config import SidecarConfig, generate_startup_token


class ExplodingLifecycle:
    def __init__(self, secret: str) -> None:
        self._secret = secret

    async def startup(self) -> None:
        return None

    async def shutdown(self) -> None:
        return None

    async def current_run(self) -> None:
        raise RuntimeError(
            f"provider leaked {self._secret} and raw document/media data"
        )

    async def start_or_resume(self) -> None:
        raise RuntimeError(self._secret)


@asynccontextmanager
async def running_client(
    lifecycle: ExplodingLifecycle,
    token: str,
) -> AsyncIterator[AsyncClient]:
    app = create_app(
        config=SidecarConfig(bearer_token=token),
        lifecycle=lifecycle,
    )
    async with app.router.lifespan_context(app):
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://sidecar.test",
        ) as client:
            yield client


@pytest.mark.asyncio
async def test_unexpected_errors_use_safe_unique_request_scoped_envelopes(
    caplog: pytest.LogCaptureFixture,
) -> None:
    token = generate_startup_token()
    unsafe_query = "private-document-title"
    caplog.set_level(logging.ERROR, logger="voxstudio_core.api")

    async with running_client(ExplodingLifecycle(token), token) as client:
        first = await client.get(
            "/v1/readiness/runs/current",
            params={"debug": unsafe_query},
            headers={"Authorization": f"Bearer {token}"},
        )
        second = await client.get(
            "/v1/readiness/runs/current",
            headers={"Authorization": f"Bearer {token}"},
        )

    assert first.status_code == 500
    body = first.json()
    assert body["code"] == "internal_error"
    assert body["message"] == "An unexpected error occurred."
    assert body["retryable"] is False
    assert body["request_id"] == first.headers["x-request-id"]
    assert body["recommended_action"] is not None
    assert body["timestamp"] is not None
    assert second.json()["request_id"] != first.json()["request_id"]
    assert token not in first.text
    assert token not in caplog.text
    assert unsafe_query not in caplog.text
    assert "document/media" not in first.text
    assert "RuntimeError" not in first.text


@pytest.mark.asyncio
async def test_authentication_errors_use_the_safe_envelope_and_challenge() -> None:
    token = generate_startup_token()

    async with running_client(ExplodingLifecycle(token), token) as client:
        response = await client.get("/readyz")

    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"
    body = response.json()
    assert body["code"] == "credential_error"
    assert body["message"] == "Authentication is required."
    assert body["retryable"] is False
    assert body["request_id"] == response.headers["x-request-id"]
    assert body["recommended_action"] is not None


@pytest.mark.asyncio
async def test_framework_generated_errors_use_the_safe_envelope() -> None:
    token = generate_startup_token()

    async with running_client(ExplodingLifecycle(token), token) as client:
        response = await client.get("/route-that-does-not-exist")

    assert response.status_code == 404
    body = response.json()
    assert body["code"] == "resource_not_found"
    assert body["message"] == "The requested resource was not found."
    assert body["retryable"] is False
    assert body["request_id"] == response.headers["x-request-id"]
    assert body["recommended_action"] is not None
