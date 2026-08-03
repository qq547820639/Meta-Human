from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient

from voxstudio_core.api.app import create_app
from voxstudio_core.config import SidecarConfig, generate_startup_token


TRUSTED_ORIGINS = (
    "tauri://localhost",
    "http://tauri.localhost",
    "http://127.0.0.1:1420",
)


class CorsLifecycle:
    def __init__(self, *, explode: bool = False, secret: str = "") -> None:
        self.explode = explode
        self.secret = secret

    async def startup(self) -> None:
        return None

    async def shutdown(self) -> None:
        return None

    async def current_run(self) -> None:
        if self.explode:
            raise RuntimeError(f"provider leaked {self.secret}")
        return None

    async def start_or_resume(self) -> None:
        if self.explode:
            raise RuntimeError(f"provider leaked {self.secret}")
        return None


@asynccontextmanager
async def running_client(
    lifecycle: CorsLifecycle,
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


def preflight_headers(
    origin: str,
    *,
    method: str,
    headers: str = "Authorization",
    private_network: bool = False,
) -> dict[str, str]:
    request_headers = {
        "Origin": origin,
        "Access-Control-Request-Method": method,
        "Access-Control-Request-Headers": headers,
    }
    if private_network:
        request_headers["Access-Control-Request-Private-Network"] = "true"
    return request_headers


@pytest.mark.asyncio
@pytest.mark.parametrize("origin", TRUSTED_ORIGINS)
async def test_trusted_origins_receive_cors_on_actual_responses(origin: str) -> None:
    token = generate_startup_token()
    async with running_client(CorsLifecycle(), token) as client:
        response = await client.get("/healthz", headers={"Origin": origin})

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin
    assert "access-control-allow-credentials" not in response.headers
    assert "access-control-allow-private-network" not in response.headers


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("method", "path"),
    (("GET", "/readyz"), ("POST", "/v1/readiness/runs")),
)
async def test_authorization_preflight_allows_only_required_methods(
    method: str,
    path: str,
) -> None:
    token = generate_startup_token()
    async with running_client(CorsLifecycle(), token) as client:
        response = await client.options(
            path,
            headers=preflight_headers(TRUSTED_ORIGINS[0], method=method),
        )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == TRUSTED_ORIGINS[0]
    assert response.headers["access-control-allow-methods"] == "GET, POST"
    assert "authorization" in response.headers[
        "access-control-allow-headers"
    ].lower()
    assert "x-debug" not in response.headers[
        "access-control-allow-headers"
    ].lower()
    assert "access-control-allow-credentials" not in response.headers
    assert "access-control-allow-private-network" not in response.headers


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("method", "headers"),
    (("DELETE", "Authorization"), ("GET", "Authorization, X-Debug")),
)
async def test_trusted_preflight_rejects_extra_methods_and_headers(
    method: str,
    headers: str,
) -> None:
    token = generate_startup_token()
    async with running_client(CorsLifecycle(), token) as client:
        response = await client.options(
            "/readyz",
            headers=preflight_headers(
                TRUSTED_ORIGINS[1],
                method=method,
                headers=headers,
            ),
        )

    assert response.status_code == 400
    assert "access-control-allow-credentials" not in response.headers
    assert "access-control-allow-private-network" not in response.headers


@pytest.mark.asyncio
async def test_untrusted_preflight_is_rejected_without_acao() -> None:
    token = generate_startup_token()
    async with running_client(CorsLifecycle(), token) as client:
        response = await client.options(
            "/readyz",
            headers=preflight_headers(
                "https://untrusted.example",
                method="GET",
            ),
        )

    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers


@pytest.mark.asyncio
async def test_private_network_preflight_is_not_enabled() -> None:
    token = generate_startup_token()
    async with running_client(CorsLifecycle(), token) as client:
        response = await client.options(
            "/readyz",
            headers=preflight_headers(
                TRUSTED_ORIGINS[2],
                method="GET",
                private_network=True,
            ),
        )

    assert response.status_code == 400
    assert "access-control-allow-private-network" not in response.headers


@pytest.mark.asyncio
async def test_untrusted_actual_response_preserves_no_acao() -> None:
    token = generate_startup_token()
    async with running_client(CorsLifecycle(), token) as client:
        response = await client.get(
            "/healthz",
            headers={"Origin": "https://untrusted.example"},
        )

    assert response.status_code == 200
    assert "access-control-allow-origin" not in response.headers


@pytest.mark.asyncio
async def test_safe_500_response_still_carries_trusted_acao() -> None:
    token = generate_startup_token()
    lifecycle = CorsLifecycle(explode=True, secret=token)
    async with running_client(lifecycle, token) as client:
        response = await client.get(
            "/readyz",
            headers={
                "Origin": TRUSTED_ORIGINS[2],
                "Authorization": f"Bearer {token}",
            },
        )

    assert response.status_code == 500
    assert response.headers["access-control-allow-origin"] == TRUSTED_ORIGINS[2]
    assert response.json() == {
        "code": "internal_error",
        "message": "An unexpected error occurred.",
        "retryable": False,
        "request_id": response.headers["x-request-id"],
    }
    assert token not in response.text
