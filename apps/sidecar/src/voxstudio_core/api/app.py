from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Protocol

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException
from starlette.middleware.cors import CORSMiddleware

from voxstudio_core.api.routes.conversation import create_conversation_router
from voxstudio_core.api.routes.feishu import (
    FeishuOAuthFactory,
    create_feishu_router,
)
from voxstudio_core.api.routes.avatar import create_avatar_router
from voxstudio_core.api.routes.health import router as health_router
from voxstudio_core.api.routes.knowledge import create_knowledge_router
from voxstudio_core.api.routes.privacy import create_privacy_router
from voxstudio_core.api.routes.readiness import (
    ReadinessLifecyclePort,
    ReadinessRunNotFoundError,
    create_readiness_router,
)
from voxstudio_core.config import SidecarConfig
from voxstudio_core.errors import (
    ErrorEnvelope,
    new_request_id,
    unexpected_error_envelope,
)
from voxstudio_core.knowledge.conversation import ConversationService
from voxstudio_core.knowledge.sources import KnowledgeSourceStore
from voxstudio_core.lifecycle import LifecycleNotAcceptingError
from voxstudio_core.security import BearerTokenGuard
from voxstudio_core.providers.avatar_build import AvatarBuildService
from voxstudio_core.providers.remote_gpu import RemoteGpuClient
from voxstudio_core.persistence.database import Database


logger = logging.getLogger("voxstudio_core.api")

TRUSTED_DESKTOP_ORIGINS = (
    "tauri://localhost",
    "http://tauri.localhost",
    "http://127.0.0.1:1420",
)


class AppLifecyclePort(ReadinessLifecyclePort, Protocol):
    async def startup(self) -> None: ...

    async def shutdown(self) -> None: ...


def create_app(
    *,
    config: SidecarConfig,
    lifecycle: AppLifecyclePort,
    conversation_service: ConversationService | None = None,
    avatar_build_service: AvatarBuildService | None = None,
    avatar_stream_client: RemoteGpuClient | None = None,
    feishu_oauth_factory: FeishuOAuthFactory | None = None,
    knowledge_sources: KnowledgeSourceStore | None = None,
    privacy_database: Database | None = None,
) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.lifecycle = lifecycle
        await lifecycle.startup()
        try:
            yield
        finally:
            await lifecycle.shutdown()

    app = FastAPI(
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
        lifespan=lifespan,
    )

    @app.middleware("http")
    async def attach_request_id(request: Request, call_next):
        request_id = new_request_id()
        request.state.request_id = request_id
        try:
            response = await call_next(request)
        except Exception as error:
            response = _unexpected_error_response(request, error)
        response.headers["X-Request-ID"] = request_id
        return response

    _register_error_handlers(app)
    app.include_router(health_router)
    guard = BearerTokenGuard(config.bearer_token)
    app.include_router(
        create_readiness_router(
            guard=guard,
            lifecycle=lifecycle,
        )
    )
    app.include_router(
        create_feishu_router(
            guard=guard,
            oauth_factory=feishu_oauth_factory,
        )
    )
    if knowledge_sources is not None:
        app.include_router(
            create_knowledge_router(
                guard=guard,
                store=knowledge_sources,
            )
        )
    if privacy_database is not None:
        app.include_router(
            create_privacy_router(
                guard=guard,
                database=privacy_database,
            )
        )
    if conversation_service is not None:
        app.include_router(
            create_conversation_router(
                guard=guard,
                service=conversation_service,
            )
        )
    if avatar_build_service is not None:
        app.include_router(
            create_avatar_router(
                guard=guard,
                service=avatar_build_service,
                stream_client=avatar_stream_client,
            )
        )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(TRUSTED_DESKTOP_ORIGINS),
        allow_methods=["GET", "POST"],
        allow_headers=["Authorization"],
        allow_credentials=False,
    )
    return app


def _register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ReadinessRunNotFoundError)
    async def readiness_run_not_found(
        request: Request,
        error: ReadinessRunNotFoundError,
    ) -> JSONResponse:
        del error
        return _error_response(
            request,
            status_code=status.HTTP_404_NOT_FOUND,
            code="readiness_run_not_found",
            message="No readiness run has been started.",
            retryable=False,
        )

    @app.exception_handler(LifecycleNotAcceptingError)
    async def lifecycle_not_accepting(
        request: Request,
        error: LifecycleNotAcceptingError,
    ) -> JSONResponse:
        del error
        return _error_response(
            request,
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            code="readiness_not_accepting",
            message="Readiness preparation is stopping.",
            retryable=True,
        )

    @app.exception_handler(RequestValidationError)
    async def request_validation_error(
        request: Request,
        error: RequestValidationError,
    ) -> JSONResponse:
        del error
        return _error_response(
            request,
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="invalid_request",
            message="The request is invalid.",
            retryable=False,
        )

    @app.exception_handler(HTTPException)
    async def http_error(
        request: Request,
        error: HTTPException,
    ) -> JSONResponse:
        code, message = _http_error_contract(error.status_code)
        return _error_response(
            request,
            status_code=error.status_code,
            code=code,
            message=message,
            retryable=False,
            headers=error.headers,
        )

    @app.exception_handler(Exception)
    async def unexpected_error(
        request: Request,
        error: Exception,
    ) -> JSONResponse:
        return _unexpected_error_response(request, error)


def _unexpected_error_response(
    request: Request,
    error: Exception,
) -> JSONResponse:
    request_id = _request_id(request)
    logger.error(
        "Unhandled request failure",
        extra={"request_id": request_id},
    )
    envelope = unexpected_error_envelope(
        error,
        request_id=request_id,
    )
    return _envelope_response(
        envelope,
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
    )


def _error_response(
    request: Request,
    *,
    status_code: int,
    code: str,
    message: str,
    retryable: bool,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    envelope = ErrorEnvelope(
        code=code,
        message=message,
        retryable=retryable,
        request_id=_request_id(request),
    )
    return _envelope_response(
        envelope,
        status_code=status_code,
        headers=headers,
    )


def _envelope_response(
    envelope: ErrorEnvelope,
    *,
    status_code: int,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    response_headers = dict(headers or {})
    response_headers["X-Request-ID"] = envelope.request_id
    return JSONResponse(
        status_code=status_code,
        content=envelope.model_dump(mode="json", exclude_none=True),
        headers=response_headers,
    )


def _request_id(request: Request) -> str:
    request_id = getattr(request.state, "request_id", None)
    return request_id if isinstance(request_id, str) else new_request_id()


def _http_error_contract(status_code: int) -> tuple[str, str]:
    if status_code == status.HTTP_401_UNAUTHORIZED:
        return "unauthorized", "Authentication is required."
    if status_code == status.HTTP_404_NOT_FOUND:
        return "not_found", "The requested resource was not found."
    if status_code == status.HTTP_405_METHOD_NOT_ALLOWED:
        return "method_not_allowed", "The request method is not allowed."
    return "request_error", "The request could not be completed."
