from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from urllib.parse import urlencode

import httpx
from pydantic import SecretStr


class FeishuOAuthError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class FeishuOAuthConfig:
    app_id: str
    app_secret: SecretStr
    redirect_uri: str
    authorize_url: str = "https://open.feishu.cn/open-apis/authen/v1/authorize"
    token_url: str = "https://open.feishu.cn/open-apis/authen/v1/oidc/access_token"
    timeout_seconds: float = 10.0

    def __post_init__(self) -> None:
        if not self.app_id.strip():
            raise ValueError("app_id must not be empty")
        if not self.redirect_uri.strip():
            raise ValueError("redirect_uri must not be empty")


@dataclass(frozen=True, slots=True)
class TokenBundle:
    access_token: str
    refresh_token: str
    expires_at: datetime


class FeishuOAuthClient:
    def __init__(
        self,
        config: FeishuOAuthConfig,
        transport: httpx.AsyncBaseTransport | None = None,
        *,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self._config = config
        self._transport = transport
        self._clock = clock or (lambda: datetime.now(UTC))

    def authorization_url(self, *, state: str) -> str:
        if not state.strip():
            raise ValueError("state must not be empty")
        params = {
            "app_id": self._config.app_id,
            "redirect_uri": self._config.redirect_uri,
            "state": state,
            "scope": "wiki:wiki:readonly docx:document:readonly",
        }
        return f"{self._config.authorize_url}?{urlencode(params)}"

    async def exchange_code(self, *, code: str) -> TokenBundle:
        return await self._request_token(
            {
                "grant_type": "authorization_code",
                "code": code,
                "client_id": self._config.app_id,
                "client_secret": self._config.app_secret.get_secret_value(),
            }
        )

    async def refresh_token(self, *, refresh_token: str) -> TokenBundle:
        return await self._request_token(
            {
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
                "client_id": self._config.app_id,
                "client_secret": self._config.app_secret.get_secret_value(),
            }
        )

    async def _request_token(self, payload: dict[str, str]) -> TokenBundle:
        async with self._client() as client:
            response = await client.post(self._config.token_url, json=payload)
            if response.status_code != 200:
                raise FeishuOAuthError(
                    f"token request failed with status {response.status_code}"
                )
            try:
                body = response.json()
            except ValueError as error:
                raise FeishuOAuthError(
                    "token response was not valid JSON"
                ) from error
            data = body.get("data") if isinstance(body.get("data"), dict) else body
            access_token = data.get("access_token")
            refresh_token = data.get("refresh_token")
            expires_in = data.get("expires_in")
            if (
                not isinstance(access_token, str)
                or not access_token
                or not isinstance(refresh_token, str)
                or not refresh_token
                or not isinstance(expires_in, int)
                or expires_in <= 0
            ):
                raise FeishuOAuthError("token response was missing required fields")
            return TokenBundle(
                access_token=access_token,
                refresh_token=refresh_token,
                expires_at=self._clock() + timedelta(seconds=expires_in),
            )

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            timeout=httpx.Timeout(self._config.timeout_seconds),
            transport=self._transport,
        )
