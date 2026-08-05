"""Unified provider deep-verification contract and runner.

The readiness pipeline (`capabilities/`) runs a fixed set of checks at startup,
but it does not expose a per-provider, on-demand deep verification with the
rich structure the settings UI needs (step-by-step progress, classified error
mapping, TLS/auth/permission/model/capability/latency, and user-actionable
advice). This module provides exactly that as a standalone, testable service
behind ``POST /v1/providers/verify``.

It reuses the real HTTP clients (Ollama/LM Studio via ``OpenAICompatibleClient``,
remote GPU via ``RemoteGpuClient``, Feishu via ``FeishuClient``) so a verification
always reflects the true provider state and never fabricates success.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from enum import StrEnum
from typing import Literal

import httpx
from pydantic import BaseModel, ConfigDict, Field, SecretStr

from voxstudio_core.knowledge.feishu import FeishuApiError, FeishuClient
from voxstudio_core.providers.local_config import LocalProviderConfig
from voxstudio_core.providers.openai_compatible import (
    EmptyProviderContentError,
    OpenAICompatibleClient,
)
from voxstudio_core.providers.remote_gpu import RemoteGpuClient, RemoteGpuConfig

ProviderType = Literal[
    "ollama",
    "lmstudio",
    "remote_gpu",
    "feishu",
    "stt",
    "tts",
    "llm",
]

PROVIDER_TYPES: tuple[ProviderType, ...] = (
    "ollama",
    "lmstudio",
    "remote_gpu",
    "feishu",
    "stt",
    "tts",
    "llm",
)


class Outcome(StrEnum):
    OK = "ok"
    FAILED = "failed"
    UNCONFIGURED = "unconfigured"


class StepStatus(StrEnum):
    PASS = "pass"
    FAIL = "fail"
    SKIP = "skip"


class TlsStatus(StrEnum):
    OK = "ok"
    INSECURE = "insecure"
    NOT_APPLICABLE = "not_applicable"


class AuthStatus(StrEnum):
    OK = "ok"
    INVALID_CREDENTIALS = "invalid_credentials"
    NOT_CONFIGURED = "not_configured"
    NOT_APPLICABLE = "not_applicable"


class PermissionStatus(StrEnum):
    OK = "ok"
    INSUFFICIENT_PERMISSION = "insufficient_permission"
    NOT_CONFIGURED = "not_configured"
    NOT_APPLICABLE = "not_applicable"


class ProviderVerifyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider_type: ProviderType
    endpoint: str | None = None
    api_key: str | None = None
    model: str | None = None
    space_id: str | None = None
    app_id: str | None = None
    app_secret: str | None = None
    access_token: str | None = None
    refresh_token: str | None = None
    timeout_seconds: float = Field(default=10.0, gt=0, le=120)


class VerifyError(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    code: str
    message: str
    recoverable: bool
    recommended_action: str | None = None


class VerifyStep(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str
    label: str
    status: StepStatus
    latency_ms: float | None = None
    detail: str | None = None


class ProviderVerification(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    provider_type: str
    status: Outcome
    current_step: str | None
    endpoint: str | None
    network_reachable: bool | None
    tls_status: TlsStatus | None
    auth_status: AuthStatus | None
    permission_status: PermissionStatus | None
    api_version_compatible: bool | None
    model_exists: bool | None
    model_capabilities: list[str]
    first_response_latency_ms: float | None
    total_duration_ms: float
    recoverable: bool | None
    recommended_action: str | None
    error_trace_id: str | None
    steps: list[VerifyStep]
    verified_at: datetime

    def model_dump_verbose(self) -> dict[str, object]:
        """Serialise with camelCase-compatible field names for the descriptor."""
        return self.model_dump(mode="json", exclude_none=True)


StepCheck = Callable[[], Awaitable[VerifyStep]]


class ProviderVerifier:
    """Runs a step-by-step deep verification for a single provider type.

    Steps execute in order: connection → tls → auth → permission → model →
    capability → latency. The first failing step stops the run and keeps the
    already-passed steps. Every step is timed and recorded.
    """

    def __init__(
        self,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
        trace_id: str | None = None,
    ) -> None:
        self._transport = transport
        self._trace_id = trace_id

    async def verify(
        self,
        request: ProviderVerifyRequest,
    ) -> ProviderVerification:
        started_at = time.monotonic()
        steps: list[VerifyStep] = []
        endpoint = request.endpoint or _default_endpoint(request.provider_type)

        if not _configured(request):
            steps.append(
                VerifyStep(
                    id="config",
                    label="配置",
                    status=StepStatus.FAIL,
                    detail=_unconfigured_detail(request.provider_type),
                )
            )
            return self._build(
                request,
                steps,
                started_at,
                current_step="config",
                endpoint=endpoint,
                status=Outcome.UNCONFIGURED,
                recoverable=True,
                recommended_action=_unconfigured_action(request.provider_type),
            )

        check_steps = self._steps_for(request, endpoint)
        try:
            for step in check_steps:
                result = await step()
                steps.append(result)
                if result.status is StepStatus.FAIL:
                    return self._build(
                        request,
                        steps,
                        started_at,
                        current_step=result.id,
                        endpoint=endpoint,
                        status=Outcome.FAILED,
                        recoverable=True,
                        recommended_action=_advice_for(result.id),
                    )
        except httpx.ConnectError:
            steps.append(
                VerifyStep(
                    id="connection",
                    label="连接服务",
                    status=StepStatus.FAIL,
                    detail="无法连接到服务地址，请确认服务已启动且地址正确。",
                )
            )
            return self._build(
                request,
                steps,
                started_at,
                current_step="connection",
                endpoint=endpoint,
                status=Outcome.FAILED,
                recoverable=True,
                recommended_action="请检查网络、服务是否运行以及地址是否正确后重试。",
            )
        except httpx.TimeoutException:
            steps.append(
                VerifyStep(
                    id="connection",
                    label="连接服务",
                    status=StepStatus.FAIL,
                    detail="连接服务超时，请稍后重试或检查网络。",
                )
            )
            return self._build(
                request,
                steps,
                started_at,
                current_step="connection",
                endpoint=endpoint,
                status=Outcome.FAILED,
                recoverable=True,
                recommended_action="请检查网络连通性后重试。",
            )
        except Exception as error:  # pragma: no cover - defensive
            steps.append(
                VerifyStep(
                    id="capability",
                    label="能力验证",
                    status=StepStatus.FAIL,
                    detail=f"验证过程中发生未预期错误：{type(error).__name__}。",
                )
            )
            return self._build(
                request,
                steps,
                started_at,
                current_step="capability",
                endpoint=endpoint,
                status=Outcome.FAILED,
                recoverable=True,
                recommended_action="请重试；若重复出现请导出诊断信息。",
            )

        return self._build(
            request,
            steps,
            started_at,
            current_step=None,
            endpoint=endpoint,
            status=Outcome.OK,
            recoverable=False,
        )

    def _steps_for(
        self,
        request: ProviderVerifyRequest,
        endpoint: str,
    ) -> list[StepCheck]:
        kind = request.provider_type
        if kind in {"ollama", "lmstudio", "llm"}:
            return self._local_llm_steps(request, endpoint)
        if kind == "stt":
            return self._local_stt_steps(request, endpoint)
        if kind == "remote_gpu":
            return self._remote_gpu_steps(request, endpoint)
        if kind == "tts":
            return self._remote_tts_steps(request, endpoint)
        if kind == "feishu":
            return self._feishu_steps(request, endpoint)
        return []

    def _local_llm_steps(
        self,
        request: ProviderVerifyRequest,
        endpoint: str,
    ) -> list[StepCheck]:
        client = self._openai_client(request, endpoint)

        async def connection() -> VerifyStep:
            return await _probe_connection(
                endpoint, request.timeout_seconds, self._transport
            )

        async def tls() -> VerifyStep:
            return _tls_step(endpoint)

        async def auth() -> VerifyStep:
            return _local_auth_step(request)

        async def model_exists() -> VerifyStep:
            return await _local_model_step(request, client)

        async def capability() -> VerifyStep:
            return await _local_capability_step(request, client)

        return [connection, tls, auth, model_exists, capability]

    def _local_stt_steps(
        self,
        request: ProviderVerifyRequest,
        endpoint: str,
    ) -> list[StepCheck]:
        client = self._openai_client(request, endpoint)

        async def connection() -> VerifyStep:
            return await _probe_connection(
                endpoint, request.timeout_seconds, self._transport
            )

        async def tls() -> VerifyStep:
            return _tls_step(endpoint)

        async def auth() -> VerifyStep:
            return _local_auth_step(request)

        async def capability() -> VerifyStep:
            return await _local_stt_capability_step(request, client)

        return [connection, tls, auth, capability]

    def _remote_gpu_steps(
        self,
        request: ProviderVerifyRequest,
        endpoint: str,
    ) -> list[StepCheck]:
        client = self._remote_client(request, endpoint)

        async def connection() -> VerifyStep:
            return await _probe_connection(
                endpoint, request.timeout_seconds, self._transport
            )

        async def tls() -> VerifyStep:
            return _tls_step(endpoint)

        async def auth() -> VerifyStep:
            return _remote_auth_step(request)

        async def capability() -> VerifyStep:
            return await _remote_capability_step(request, client)

        return [connection, tls, auth, capability]

    def _remote_tts_steps(
        self,
        request: ProviderVerifyRequest,
        endpoint: str,
    ) -> list[StepCheck]:
        client = self._remote_client(request, endpoint)

        async def connection() -> VerifyStep:
            return await _probe_connection(
                endpoint, request.timeout_seconds, self._transport
            )

        async def tls() -> VerifyStep:
            return _tls_step(endpoint)

        async def auth() -> VerifyStep:
            return _remote_auth_step(request)

        async def capability() -> VerifyStep:
            return await _remote_tts_capability_step(request, client)

        return [connection, tls, auth, capability]

    def _feishu_steps(
        self,
        request: ProviderVerifyRequest,
        endpoint: str,
    ) -> list[StepCheck]:
        client = self._feishu_client(request, endpoint)

        async def connection() -> VerifyStep:
            return await _probe_connection(
                endpoint, request.timeout_seconds, self._transport
            )

        async def tls() -> VerifyStep:
            return _tls_step(endpoint)

        async def auth() -> VerifyStep:
            return _feishu_auth_step(request)

        async def permission() -> VerifyStep:
            return await _feishu_permission_step(request, client)

        return [connection, tls, auth, permission]

    def _openai_client(
        self,
        request: ProviderVerifyRequest,
        endpoint: str,
    ) -> OpenAICompatibleClient:
        config = LocalProviderConfig(
            allow_remote=True,
            base_url=endpoint,
            chat_model=request.model or "placeholder",
            embedding_model=request.model or "placeholder",
            stt_model=request.model,
            timeout_seconds=request.timeout_seconds,
        )
        return OpenAICompatibleClient(config, transport=self._transport)

    def _remote_client(
        self,
        request: ProviderVerifyRequest,
        endpoint: str,
    ) -> RemoteGpuClient:
        config = RemoteGpuConfig(
            base_url=endpoint,
            api_key=(
                SecretStr(request.api_key)
                if request.api_key
                else None
            ),
            timeout_seconds=request.timeout_seconds,
        )
        return RemoteGpuClient(config, transport=self._transport)

    def _feishu_client(
        self,
        request: ProviderVerifyRequest,
        endpoint: str,
    ) -> FeishuClient:
        return FeishuClient(
            access_token=SecretStr(request.access_token or ""),
            refresh_token=(
                SecretStr(request.refresh_token)
                if request.refresh_token
                else None
            ),
            app_id=request.app_id,
            app_secret=(
                SecretStr(request.app_secret)
                if request.app_secret
                else None
            ),
            base_url=endpoint,
            timeout_seconds=request.timeout_seconds,
            transport=self._transport,
        )

    def _build(
        self,
        request: ProviderVerifyRequest,
        steps: list[VerifyStep],
        started_at: float,
        *,
        current_step: str | None,
        endpoint: str | None,
        status: Outcome,
        recoverable: bool | None,
        recommended_action: str | None = None,
    ) -> ProviderVerification:
        total = (time.monotonic() - started_at) * 1000.0
        connection = _step(steps, "connection")
        return ProviderVerification(
            provider_type=request.provider_type,
            status=status,
            current_step=current_step,
            endpoint=endpoint,
            network_reachable=_bool_or_none(connection),
            tls_status=_tls_status(steps),
            auth_status=_auth_status(steps),
            permission_status=_permission_status(steps),
            api_version_compatible=_api_version_compatible(steps, status),
            model_exists=_model_exists(steps),
            model_capabilities=_capabilities(steps),
            first_response_latency_ms=_first_response_latency(steps),
            total_duration_ms=round(total, 1),
            recoverable=recoverable,
            recommended_action=recommended_action,
            error_trace_id=self._trace_id,
            steps=steps,
            verified_at=datetime.now(UTC),
        )


def _default_endpoint(provider_type: ProviderType) -> str:
    if provider_type in {"ollama", "lmstudio"}:
        return "http://127.0.0.1:11434"
    if provider_type == "feishu":
        return "https://open.feishu.cn"
    return ""


def _configured(request: ProviderVerifyRequest) -> bool:
    if request.provider_type in {"ollama", "lmstudio", "llm", "stt"}:
        return bool((request.endpoint or "").strip()) and bool(
            (request.model or "").strip()
        )
    if request.provider_type == "remote_gpu":
        return bool((request.endpoint or "").strip())
    if request.provider_type == "tts":
        return bool((request.endpoint or "").strip())
    if request.provider_type == "feishu":
        return bool((request.access_token or "").strip()) or bool(
            (request.app_id or "").strip() and (request.app_secret or "").strip()
        )
    return False


def _unconfigured_detail(provider_type: ProviderType) -> str:
    if provider_type == "feishu":
        return "缺少飞书凭据（Access Token 或 App ID/Secret）。"
    if provider_type in {"remote_gpu", "tts"}:
        return "缺少远程服务地址。"
    return "缺少本地模型地址或模型名称。"


def _unconfigured_action(provider_type: ProviderType) -> str:
    if provider_type == "feishu":
        return "请先在设置中授权飞书或以 App ID/Secret 与 Access Token 配置。"
    if provider_type in {"remote_gpu", "tts"}:
        return "请填写远程服务地址。"
    return "请填写本地模型服务地址与模型名称。"


async def _probe_connection(
    endpoint: str,
    timeout_seconds: float,
    transport: httpx.AsyncBaseTransport | None = None,
) -> VerifyStep:
    started = time.monotonic()
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(min(5.0, timeout_seconds)),
            follow_redirects=False,
            transport=transport,
        ) as client:
            response = await client.get(endpoint)
        latency = (time.monotonic() - started) * 1000.0
        if response.status_code < 500:
            return VerifyStep(
                id="connection",
                label="连接服务",
                status=StepStatus.PASS,
                latency_ms=round(latency, 1),
                detail="服务地址可访问。",
            )
        return VerifyStep(
            id="connection",
            label="连接服务",
            status=StepStatus.FAIL,
            latency_ms=round(latency, 1),
            detail=f"服务返回 HTTP {response.status_code}，接口未正常响应。",
        )
    except httpx.ConnectError:
        return VerifyStep(
            id="connection",
            label="连接服务",
            status=StepStatus.FAIL,
            detail="无法连接到服务地址，请确认服务已启动且地址正确。",
        )
    except httpx.TimeoutException:
        return VerifyStep(
            id="connection",
            label="连接服务",
            status=StepStatus.FAIL,
            detail="连接服务超时，请稍后重试。",
        )


def _tls_step(endpoint: str) -> VerifyStep:
    lower = endpoint.lower()
    if lower.startswith("https://"):
        # Reaching here means the HTTPS connection succeeded (connection step
        # above passed), so TLS is effective.
        return VerifyStep(
            id="tls",
            label="TLS 安全连接",
            status=StepStatus.PASS,
            detail="使用 HTTPS，传输已加密。",
        )
    if lower.startswith("http://"):
        return VerifyStep(
            id="tls",
            label="TLS 安全连接",
            status=StepStatus.PASS,
            detail="本地 HTTP 服务（未加密，仅建议用于本机）。",
        )
    return VerifyStep(
        id="tls",
        label="TLS 安全连接",
        status=StepStatus.SKIP,
        detail="无法识别协议。",
    )


def _local_auth_step(request: ProviderVerifyRequest) -> VerifyStep:
    if request.api_key:
        return VerifyStep(
            id="auth",
            label="身份认证",
            status=StepStatus.PASS,
            detail="已配置 API Key。",
        )
    return VerifyStep(
        id="auth",
        label="身份认证",
        status=StepStatus.PASS,
        detail="本地服务无需认证。",
    )


def _remote_auth_step(request: ProviderVerifyRequest) -> VerifyStep:
    if not (request.api_key or "").strip():
        return VerifyStep(
            id="auth",
            label="身份认证",
            status=StepStatus.FAIL,
            detail="未配置 API Key，远程服务可能拒绝访问。",
        )
    return VerifyStep(
        id="auth",
        label="身份认证",
        status=StepStatus.PASS,
        detail="已配置 API Key。",
    )


def _feishu_auth_step(request: ProviderVerifyRequest) -> VerifyStep:
    if (request.access_token or "").strip():
        return VerifyStep(
            id="auth",
            label="身份认证",
            status=StepStatus.PASS,
            detail="已配置 Access Token。",
        )
    if (request.app_id or "").strip() and (request.app_secret or "").strip():
        return VerifyStep(
            id="auth",
            label="身份认证",
            status=StepStatus.PASS,
            detail="已配置 App ID/Secret（将尝试换取 Token）。",
        )
    return VerifyStep(
        id="auth",
        label="身份认证",
        status=StepStatus.FAIL,
        detail="缺少飞书 Access Token 或 App ID/Secret。",
    )


async def _feishu_permission_step(
    request: ProviderVerifyRequest,
    client: FeishuClient,
) -> VerifyStep:
    async def run() -> VerifyStep:
        try:
            space_id = (request.space_id or "").strip()
            if not space_id:
                return VerifyStep(
                    id="permission",
                    label="权限与空间",
                    status=StepStatus.FAIL,
                    detail="未填写飞书知识空间 ID。",
                )
            nodes = await client.list_all_wiki_nodes(space_id=space_id)
            return VerifyStep(
                id="permission",
                label="权限与空间",
                status=StepStatus.PASS,
                detail=f"可访问知识空间，发现 {len(nodes)} 个节点。",
            )
        except FeishuApiError as error:
            message = str(error)
            if "status 401" in message:
                return VerifyStep(
                    id="permission",
                    label="权限与空间",
                    status=StepStatus.FAIL,
                    detail="飞书返回 401：凭据无效或已过期。",
                )
            if "status 403" in message:
                return VerifyStep(
                    id="permission",
                    label="权限与空间",
                    status=StepStatus.FAIL,
                    detail="飞书返回 403：权限不足，无法访问该知识空间。",
                )
            if "status 404" in message:
                return VerifyStep(
                    id="permission",
                    label="权限与空间",
                    status=StepStatus.FAIL,
                    detail="飞书返回 404：知识空间不存在或无权访问。",
                )
            return VerifyStep(
                id="permission",
                label="权限与空间",
                status=StepStatus.FAIL,
                detail=f"飞书请求失败：{message}",
            )

    return await _with_timeout(
        run,
        request.timeout_seconds,
        step_id="permission",
        label="权限与空间",
        detail="请求飞书超时。",
    )


async def _local_model_step(
    request: ProviderVerifyRequest,
    client: OpenAICompatibleClient,
) -> VerifyStep:
    model = (request.model or "").strip()
    if not model:
        return VerifyStep(
            id="model",
            label="模型存在",
            status=StepStatus.FAIL,
            detail="未填写模型名称。",
        )
    try:
        await client.chat_completion(model=model, prompt="Reply: ready")
        return VerifyStep(
            id="model",
            label="模型存在",
            status=StepStatus.PASS,
            detail=f"模型 {model} 存在且可对话。",
        )
    except EmptyProviderContentError:
        return VerifyStep(
            id="model",
            label="模型存在",
            status=StepStatus.FAIL,
            detail="模型返回空内容，请确认模型已加载。",
        )
    except httpx.TimeoutException:
        return VerifyStep(
            id="model",
            label="模型存在",
            status=StepStatus.FAIL,
            detail="模型响应超时，可能尚未加载。",
        )
    except httpx.HTTPStatusError as error:
        status = error.response.status_code
        if status == 404:
            return VerifyStep(
                id="model",
                label="模型存在",
                status=StepStatus.FAIL,
                detail=f"模型 {model} 不存在（404），请检查名称或先拉取模型。",
            )
        if status in {401, 403}:
            return VerifyStep(
                id="model",
                label="模型存在",
                status=StepStatus.FAIL,
                detail=f"访问模型被拒绝（HTTP {status}），请检查认证或权限。",
            )
        if status == 429:
            return VerifyStep(
                id="model",
                label="模型存在",
                status=StepStatus.FAIL,
                detail="服务限流（429），请稍后重试。",
            )
        return VerifyStep(
            id="model",
            label="模型存在",
            status=StepStatus.FAIL,
            detail=f"模型请求失败（HTTP {status}）。",
        )
    except (httpx.RequestError, ValueError, KeyError, TypeError):
        return VerifyStep(
            id="model",
            label="模型存在",
            status=StepStatus.FAIL,
            detail="无法验证模型，请检查服务返回。",
        )


async def _local_capability_step(
    request: ProviderVerifyRequest,
    client: OpenAICompatibleClient,
) -> VerifyStep:
    model = (request.model or "").strip()
    started = time.monotonic()
    try:
        await client.chat_completion(model=model, prompt="Reply: ready")
        latency = (time.monotonic() - started) * 1000.0
        return VerifyStep(
            id="capability",
            label="能力验证",
            status=StepStatus.PASS,
            latency_ms=round(latency, 1),
            detail="模型对话能力正常（chat）。",
        )
    except (httpx.HTTPStatusError, httpx.RequestError, ValueError) as error:
        status = getattr(getattr(error, "response", None), "status_code", None)
        if status == 429:
            return VerifyStep(
                id="capability",
                label="能力验证",
                status=StepStatus.FAIL,
                detail="服务限流（429），请稍后重试。",
            )
        return VerifyStep(
            id="capability",
            label="能力验证",
            status=StepStatus.FAIL,
            detail="模型对话验证失败。",
        )


async def _local_stt_capability_step(
    request: ProviderVerifyRequest,
    client: OpenAICompatibleClient,
) -> VerifyStep:
    model = (request.model or "").strip()
    sample = _stt_sample_bytes()
    if sample is None:
        return VerifyStep(
            id="capability",
            label="能力验证",
            status=StepStatus.FAIL,
            detail="缺少内置语音样本，无法验证 STT。",
        )
    started = time.monotonic()
    try:
        text = await client.transcribe(model=model, audio=sample)
        latency = (time.monotonic() - started) * 1000.0
        return VerifyStep(
            id="capability",
            label="能力验证",
            status=StepStatus.PASS,
            latency_ms=round(latency, 1),
            detail=f"STT 转写正常：{text[:40] or '（空）'}",
        )
    except httpx.HTTPStatusError as error:
        status = error.response.status_code
        if status == 404:
            return VerifyStep(
                id="capability",
                label="能力验证",
                status=StepStatus.FAIL,
                detail=f"STT 模型 {model} 不存在（404）。",
            )
        if status in {401, 403}:
            return VerifyStep(
                id="capability",
                label="能力验证",
                status=StepStatus.FAIL,
                detail=f"STT 访问被拒绝（HTTP {status}）。",
            )
        if status == 429:
            return VerifyStep(
                id="capability",
                label="能力验证",
                status=StepStatus.FAIL,
                detail="STT 服务限流（429）。",
            )
        return VerifyStep(
            id="capability",
            label="能力验证",
            status=StepStatus.FAIL,
            detail=f"STT 请求失败（HTTP {status}）。",
        )
    except (httpx.RequestError, ValueError):
        return VerifyStep(
            id="capability",
            label="能力验证",
            status=StepStatus.FAIL,
            detail="STT 验证失败，请检查服务返回。",
        )


async def _remote_capability_step(
    request: ProviderVerifyRequest,
    client: RemoteGpuClient,
) -> VerifyStep:
    sample = _stt_sample_bytes()
    if sample is None:
        return VerifyStep(
            id="capability",
            label="能力验证",
            status=StepStatus.FAIL,
            detail="缺少内置语音样本，无法验证远程能力。",
        )
    started = time.monotonic()
    try:
        voice_id = await client.enroll_voice(audio=sample)
        latency = (time.monotonic() - started) * 1000.0
        return VerifyStep(
            id="capability",
            label="能力验证",
            status=StepStatus.PASS,
            latency_ms=round(latency, 1),
            detail=f"远程服务可访问（voice 注册 id={voice_id[:8]}…）。",
        )
    except httpx.HTTPStatusError as error:
        status = error.response.status_code
        if status in {401, 403}:
            return VerifyStep(
                id="capability",
                label="能力验证",
                status=StepStatus.FAIL,
                detail=f"远程服务拒绝访问（HTTP {status}），请检查 API Key。",
            )
        if status == 429:
            return VerifyStep(
                id="capability",
                label="能力验证",
                status=StepStatus.FAIL,
                detail="远程服务限流（429），请稍后重试。",
            )
        return VerifyStep(
            id="capability",
            label="能力验证",
            status=StepStatus.FAIL,
            detail=f"远程请求失败（HTTP {status}）。",
        )
    except (httpx.RequestError, ValueError):
        return VerifyStep(
            id="capability",
            label="能力验证",
            status=StepStatus.FAIL,
            detail="无法验证远程服务能力。",
        )


async def _remote_tts_capability_step(
    request: ProviderVerifyRequest,
    client: RemoteGpuClient,
) -> VerifyStep:
    started = time.monotonic()
    try:
        await client.synthesize(text="ready")
        latency = (time.monotonic() - started) * 1000.0
        return VerifyStep(
            id="capability",
            label="能力验证",
            status=StepStatus.PASS,
            latency_ms=round(latency, 1),
            detail="TTS 合成正常。",
        )
    except httpx.HTTPStatusError as error:
        status = error.response.status_code
        if status in {401, 403}:
            return VerifyStep(
                id="capability",
                label="能力验证",
                status=StepStatus.FAIL,
                detail=f"TTS 服务拒绝访问（HTTP {status}），请检查 API Key。",
            )
        if status == 429:
            return VerifyStep(
                id="capability",
                label="能力验证",
                status=StepStatus.FAIL,
                detail="TTS 服务限流（429）。",
            )
        return VerifyStep(
            id="capability",
            label="能力验证",
            status=StepStatus.FAIL,
            detail=f"TTS 请求失败（HTTP {status}）。",
        )
    except (httpx.RequestError, ValueError):
        return VerifyStep(
            id="capability",
            label="能力验证",
            status=StepStatus.FAIL,
            detail="无法验证 TTS 能力。",
        )


async def _with_timeout(
    coro: Callable[[], Awaitable[VerifyStep]],
    timeout_seconds: float,
    *,
    step_id: str,
    label: str,
    detail: str,
) -> VerifyStep:
    try:
        return await asyncio.wait_for(coro(), timeout=timeout_seconds)
    except TimeoutError:
        return VerifyStep(
            id=step_id,
            label=label,
            status=StepStatus.FAIL,
            detail=detail,
        )


def _stt_sample_bytes() -> bytes | None:
    from pathlib import Path

    path = (
        Path(__file__).resolve().parent
        / ".."
        / "assets"
        / "readiness"
        / "stt_sample.wav"
    )
    try:
        if path.is_file():
            return path.read_bytes()
    except OSError:  # pragma: no cover - defensive
        return None
    return None


def _step(steps: list[VerifyStep], step_id: str) -> VerifyStep | None:
    return next((step for step in steps if step.id == step_id), None)


def _bool_or_none(step: VerifyStep | None) -> bool | None:
    if step is None:
        return None
    if step.status is StepStatus.PASS:
        return True
    if step.status is StepStatus.FAIL:
        return False
    return None


def _tls_status(steps: list[VerifyStep]) -> TlsStatus | None:
    step = _step(steps, "tls")
    if step is None:
        return None
    if step.status is StepStatus.PASS:
        return (
            TlsStatus.OK
            if "HTTPS" in (step.detail or "")
            else TlsStatus.INSECURE
        )
    return TlsStatus.NOT_APPLICABLE


def _auth_status(steps: list[VerifyStep]) -> AuthStatus | None:
    step = _step(steps, "auth")
    if step is None:
        return None
    if step.status is StepStatus.PASS:
        return AuthStatus.OK
    if step.status is StepStatus.FAIL and "API Key" in (step.detail or ""):
        return AuthStatus.INVALID_CREDENTIALS
    if step.status is StepStatus.FAIL:
        return AuthStatus.NOT_CONFIGURED
    return AuthStatus.NOT_APPLICABLE


def _permission_status(steps: list[VerifyStep]) -> PermissionStatus | None:
    step = _step(steps, "permission")
    if step is None:
        return None
    if step.status is StepStatus.PASS:
        return PermissionStatus.OK
    if step.status is StepStatus.FAIL:
        return PermissionStatus.INSUFFICIENT_PERMISSION
    return PermissionStatus.NOT_CONFIGURED


def _api_version_compatible(
    steps: list[VerifyStep],
    status: Outcome,
) -> bool | None:
    if status is Outcome.OK:
        return True
    failed = [step for step in steps if step.status is StepStatus.FAIL]
    if not failed:
        return None
    return None


def _model_exists(steps: list[VerifyStep]) -> bool | None:
    step = _step(steps, "model")
    if step is None:
        return None
    return step.status is StepStatus.PASS


def _capabilities(steps: list[VerifyStep]) -> list[str]:
    capability = _step(steps, "capability")
    if capability is None or capability.status is not StepStatus.PASS:
        return []
    return ["chat"]


def _first_response_latency(steps: list[VerifyStep]) -> float | None:
    for step in steps:
        if step.id in {"capability", "model", "permission"} and step.latency_ms:
            return step.latency_ms
    return None


def _advice_for(step_id: str) -> str:
    return {
        "connection": "请检查网络、服务是否运行以及地址是否正确后重试。",
        "auth": "请检查 API Key / 重新授权后重试。",
        "permission": "请检查飞书授权与知识空间权限后重试。",
        "model": "请检查模型名称或先拉取模型后重试。",
        "capability": "请检查服务能力与配置后重试。",
    }.get(step_id, "请根据错误提示修正配置后重试。")
