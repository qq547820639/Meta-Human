from contextlib import asynccontextmanager
from typing import AsyncIterator

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
        raise AssertionError("health checks must not start readiness work")


@asynccontextmanager
async def running_client(
    lifecycle: EmptyLifecycle,
) -> AsyncIterator[AsyncClient]:
    config = SidecarConfig(bearer_token=generate_startup_token())
    app = create_app(config=config, lifecycle=lifecycle)
    async with app.router.lifespan_context(app):
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://sidecar.test",
        ) as client:
            yield client


@pytest.mark.asyncio
async def test_healthz_is_the_public_minimal_liveness_route() -> None:
    lifecycle = EmptyLifecycle()

    async with running_client(lifecycle) as client:
        response = await client.get(
            "/healthz",
            headers={"Origin": "https://untrusted.example"},
        )

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert response.headers["x-request-id"]
    assert "access-control-allow-origin" not in response.headers
    assert lifecycle.started is True
    assert lifecycle.stopped is True


@pytest.mark.asyncio
@pytest.mark.parametrize("path", ("/docs", "/redoc", "/openapi.json"))
async def test_interactive_docs_and_openapi_are_disabled_by_default(
    path: str,
) -> None:
    async with running_client(EmptyLifecycle()) as client:
        response = await client.get(path)

    assert response.status_code == 404

