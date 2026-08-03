from collections.abc import Callable
from datetime import datetime
import os

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field, SecretStr

from voxstudio_core.knowledge.oauth import (
    FeishuOAuthClient,
    FeishuOAuthConfig,
    FeishuOAuthError,
)
from voxstudio_core.security import BearerTokenGuard


class FeishuTokenRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str = Field(min_length=1)
    app_id: str = Field(min_length=1)
    app_secret: str = Field(min_length=1)
    redirect_uri: str = Field(min_length=1)


class FeishuTokenResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    access_token: str
    refresh_token: str
    expires_at: datetime


FeishuOAuthFactory = Callable[[str, str, str], FeishuOAuthClient]


def create_feishu_router(
    *,
    guard: BearerTokenGuard,
    oauth_factory: FeishuOAuthFactory | None = None,
) -> APIRouter:
    router = APIRouter(dependencies=[Depends(guard)])

    @router.post(
        "/v1/feishu/oauth/token",
        response_model=FeishuTokenResponse,
    )
    async def exchange_token(payload: FeishuTokenRequest) -> FeishuTokenResponse:
        factory = oauth_factory or _default_oauth_factory
        client = factory(
            payload.app_id,
            payload.app_secret,
            payload.redirect_uri,
        )
        try:
            bundle = await client.exchange_code(code=payload.code)
        except FeishuOAuthError as error:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=str(error),
            ) from error
        return FeishuTokenResponse(
            access_token=bundle.access_token,
            refresh_token=bundle.refresh_token,
            expires_at=bundle.expires_at,
        )

    return router


def _default_oauth_factory(
    app_id: str,
    app_secret: str,
    redirect_uri: str,
) -> FeishuOAuthClient:
    base_url = os.environ.get(
        "VOXSTUDIO_FEISHU_BASE_URL",
        "https://open.feishu.cn",
    ).rstrip("/")
    return FeishuOAuthClient(
        FeishuOAuthConfig(
            app_id=app_id,
            app_secret=SecretStr(app_secret),
            redirect_uri=redirect_uri,
            authorize_url=(
                f"{base_url}/open-apis/authen/v1/authorize"
            ),
            token_url=(
                f"{base_url}/open-apis/authen/v1/oidc/access_token"
            ),
        )
    )
