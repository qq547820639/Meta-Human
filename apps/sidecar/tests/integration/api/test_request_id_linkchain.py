"""Tests for per-request request_id correlation and structured logging.

Verifies that a single request_id is used across the whole request lifecycle:
the response header, the error envelope, and every log record emitted for that
request share the same id -- including when the client supplies its own id.
"""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient

from voxstudio_core.api.app import create_app
from voxstudio_core.config import SidecarConfig, generate_startup_token
from voxstudio_core.telemetry import valid_request_id


class RecordingLifecycle:
    def __init__(self, secret: str) -> None:
        self._secret = secret

    async def startup(self) -> None:
        return None

    async def shutdown(self) -> None:
        return None

    async def current_run(self) -> None:
        raise RuntimeError(f"provider leaked {self._secret}")

    async def start_or_resume(self) -> None:
        raise RuntimeError(self._secret)


@asynccontextmanager
async def running_client(
    lifecycle: RecordingLifecycle,
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
async def test_each_request_uses_one_request_id_across_header_log_and_error(
    caplog: pytest.LogCaptureFixture,
) -> None:
    token = generate_startup_token()
    caplog.set_level(logging.INFO, logger="voxstudio_core.api")

    async with running_client(RecordingLifecycle(token), token) as client:
        response = await client.get(
            "/v1/readiness/runs/current",
            headers={"Authorization": f"Bearer {token}"},
        )

    request_id = response.headers["x-request-id"]
    assert request_id
    assert valid_request_id(request_id)
    assert response.json()["request_id"] == request_id

    # The request-completed log line for this request carries the same id.
    matching = [
        record
        for record in caplog.records
        if record.getMessage() == "request completed"
    ]
    assert len(matching) == 1
    assert matching[0].request_id == request_id
    assert matching[0].path == "/v1/readiness/runs/current"
    assert matching[0].status == 500
    assert isinstance(matching[0].duration_ms, float)


@pytest.mark.asyncio
async def test_client_supplied_request_id_is_propagated(
    caplog: pytest.LogCaptureFixture,
) -> None:
    token = generate_startup_token()
    supplied = "client-generated-request-id-123"
    caplog.set_level(logging.INFO, logger="voxstudio_core.api")

    async with running_client(RecordingLifecycle(token), token) as client:
        response = await client.get(
            "/readyz",
            headers={
                "Authorization": f"Bearer {token}",
                "X-Request-ID": supplied,
            },
        )

    assert response.headers["x-request-id"] == supplied
    assert response.json()["request_id"] == supplied
    matching = [
        record
        for record in caplog.records
        if record.getMessage() == "request completed"
    ]
    assert matching[0].request_id == supplied


@pytest.mark.asyncio
async def test_invalid_client_request_id_is_rejected_and_replaced() -> None:
    token = generate_startup_token()

    async with running_client(RecordingLifecycle(token), token) as client:
        response = await client.get(
            "/readyz",
            headers={
                "Authorization": f"Bearer {token}",
                "X-Request-ID": "not a valid id !!!",
            },
        )

    generated = response.headers["x-request-id"]
    assert generated != "not a valid id !!!"
    assert valid_request_id(generated)


@pytest.mark.asyncio
async def test_request_id_does_not_leak_into_other_requests() -> None:
    token = generate_startup_token()
    lifecycle = RecordingLifecycle(token)

    async with running_client(lifecycle, token) as client:
        first = await client.get(
            "/readyz",
            headers={
                "Authorization": f"Bearer {token}",
                "X-Request-ID": "alpha-request-id",
            },
        )
        second = await client.get(
            "/readyz",
            headers={
                "Authorization": f"Bearer {token}",
                "X-Request-ID": "beta-request-id",
            },
        )

    assert first.headers["x-request-id"] == "alpha-request-id"
    assert second.headers["x-request-id"] == "beta-request-id"


@pytest.mark.asyncio
async def test_request_id_is_propagated_into_nested_async_logs() -> None:
    # The contextvar autopropagates into child tasks created inside the request
    # context, so nested logs emitted by services share the same request_id.
    from voxstudio_core.telemetry import current_request_id, reset_request_id, set_request_id

    token = set_request_id("nested-chain-request")
    try:
        async def child() -> str:
            await asyncio.sleep(0)
            return current_request_id()

        assert await child() == "nested-chain-request"
    finally:
        reset_request_id(token)
        assert current_request_id() == ""