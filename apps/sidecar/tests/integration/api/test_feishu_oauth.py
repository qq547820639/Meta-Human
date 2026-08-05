from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime

import pytest
from httpx import ASGITransport, AsyncClient

from voxstudio_core.api.app import create_app
from voxstudio_core.config import SidecarConfig, generate_startup_token
from voxstudio_core.knowledge.oauth import TokenBundle


class FakeFeishuOAuthClient:
    def __init__(self) -> None:
        self.received = []

    async def exchange_code(self, *, code: str) -> TokenBundle:
        self.received.append(code)
        return TokenBundle(
            access_token="access-token",
            refresh_token="refresh-token",
            expires_at=datetime(2026, 8, 3, tzinfo=UTC),
        )


class EmptyLifecycle:
    async def startup(self) -> None:
        return None

    async def shutdown(self) -> None:
        return None

    async def current_run(self):
        return None

    async def start_or_resume(self):
        return None


@asynccontextmanager
async def running_client(
    token: str,
    client: FakeFeishuOAuthClient,
) -> AsyncIterator[AsyncClient]:
    def factory(
        app_id: str,
        app_secret: str,
        redirect_uri: str,
    ) -> FakeFeishuOAuthClient:
        client.received.append((app_id, app_secret, redirect_uri))
        return client

    app = create_app(
        config=SidecarConfig(bearer_token=token),
        lifecycle=EmptyLifecycle(),
        feishu_oauth_factory=factory,
    )
    async with app.router.lifespan_context(app):
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://sidecar.test",
        ) as async_client:
            yield async_client


@pytest.mark.asyncio
async def test_feishu_oauth_route_exchanges_code_and_returns_refresh_token() -> None:
    token = generate_startup_token()
    client = FakeFeishuOAuthClient()
    async with running_client(token, client) as http:
        response = await http.post(
            "/v1/feishu/oauth/token",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "code": "code-1",
                "app_id": "cli_app",
                "app_secret": "secret",
                "redirect_uri": "http://127.0.0.1:43125/oauth/feishu",
            },
        )

    assert response.status_code == 200
    assert response.json() == {
        "access_token": "access-token",
        "refresh_token": "refresh-token",
        "expires_at": "2026-08-03T00:00:00Z",
    }
    assert client.received[0][0] == "cli_app"
    assert client.received[1] == "code-1"


@pytest.mark.asyncio
async def test_feishu_oauth_route_requires_bearer_token() -> None:
    token = generate_startup_token()
    async with running_client(token, FakeFeishuOAuthClient()) as http:
        response = await http.post(
            "/v1/feishu/oauth/token",
            json={
                "code": "code-1",
                "app_id": "cli_app",
                "app_secret": "secret",
                "redirect_uri": "http://127.0.0.1:43125/oauth/feishu",
            },
        )

    assert response.status_code == 401
