from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from pydantic import SecretStr

from voxstudio_core.knowledge.oauth import (
    FeishuOAuthClient,
    FeishuOAuthConfig,
    FeishuOAuthError,
)


def config() -> FeishuOAuthConfig:
    return FeishuOAuthConfig(
        app_id="cli_app",
        app_secret=SecretStr("app-secret"),
        redirect_uri="http://127.0.0.1:1420/oauth/callback",
    )


def test_authorization_url_contains_app_redirect_and_state() -> None:
    client = FeishuOAuthClient(config())

    url = client.authorization_url(state="state-123")
    parsed = urlparse(url)
    params = parse_qs(parsed.query)

    assert parsed.netloc == "open.feishu.cn"
    assert params["app_id"] == ["cli_app"]
    assert params["redirect_uri"] == [
        "http://127.0.0.1:1420/oauth/callback"
    ]
    assert params["state"] == ["state-123"]
    assert "app-secret" not in url


def test_empty_state_is_rejected() -> None:
    client = FeishuOAuthClient(config())

    with pytest.raises(ValueError, match="state"):
        client.authorization_url(state="  ")


@pytest.mark.asyncio
async def test_exchange_code_returns_token_bundle() -> None:
    requests: list[httpx.Request] = []
    now = datetime(2026, 8, 1, 9, 0, tzinfo=UTC)

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(
            200,
            json={
                "data": {
                    "access_token": "access-token",
                    "refresh_token": "refresh-token",
                    "expires_in": 7200,
                }
            },
        )

    client = FeishuOAuthClient(
        config(),
        transport=httpx.MockTransport(handler),
        clock=lambda: now,
    )

    bundle = await client.exchange_code(code="code-1")

    assert bundle.access_token == "access-token"
    assert bundle.refresh_token == "refresh-token"
    assert bundle.expires_at == now + timedelta(seconds=7200)
    assert requests[0].url.path.endswith("/authen/v1/oidc/access_token")


@pytest.mark.asyncio
async def test_refresh_token_uses_refresh_grant() -> None:
    requests: list[httpx.Request] = []
    client = FeishuOAuthClient(
        config(),
        transport=httpx.MockTransport(
            lambda request: (
                requests.append(request),
                httpx.Response(
                    200,
                    json={
                        "data": {
                            "access_token": "access-2",
                            "refresh_token": "refresh-2",
                            "expires_in": 3600,
                        }
                    },
                ),
            )[1]
        ),
    )

    bundle = await client.refresh_token(refresh_token="old-refresh")

    assert bundle.access_token == "access-2"
    assert "refresh_token" in requests[0].content.decode()


@pytest.mark.asyncio
async def test_non_200_token_response_raises_safe_error() -> None:
    client = FeishuOAuthClient(
        config(),
        transport=httpx.MockTransport(lambda _: httpx.Response(400)),
    )

    with pytest.raises(FeishuOAuthError, match="status 400"):
        await client.exchange_code(code="bad-code")


@pytest.mark.asyncio
async def test_invalid_token_response_raises_safe_error() -> None:
    client = FeishuOAuthClient(
        config(),
        transport=httpx.MockTransport(
            lambda _: httpx.Response(200, text="not-json")
        ),
    )

    with pytest.raises(FeishuOAuthError, match="not valid JSON"):
        await client.exchange_code(code="bad-code")


def test_config_repr_does_not_leak_secret() -> None:
    assert "app-secret" not in repr(config())
