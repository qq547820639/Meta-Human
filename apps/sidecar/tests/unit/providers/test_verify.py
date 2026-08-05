from __future__ import annotations

import asyncio

import httpx
import pytest

from voxstudio_core.providers.verify import (
    ProviderVerifier,
    ProviderVerifyRequest,
)

LOCAL_LLM = "http://127.0.0.1:11434"


def verifier(
    handler: httpx.MockTransport,
    *,
    trace_id: str | None = None,
) -> ProviderVerifier:
    return ProviderVerifier(transport=handler, trace_id=trace_id)


def chat_handler(
    *,
    chat_status: int = 200,
    content: str = "ready",
) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/chat/completions"):
            return httpx.Response(
                chat_status,
                json={
                    "choices": [
                        {
                            "message": {
                                "role": "assistant",
                                "content": content,
                            }
                        }
                    ]
                },
            )
        return httpx.Response(200)

    return httpx.MockTransport(handler)


def ollama_request(**overrides: object) -> ProviderVerifyRequest:
    defaults: dict[str, object] = {
        "provider_type": "ollama",
        "endpoint": LOCAL_LLM,
        "model": "qwen2.5",
    }
    defaults.update(overrides)
    return ProviderVerifyRequest(**defaults)


@pytest.mark.asyncio
async def test_unconfigured_local_llm_returns_unconfigured() -> None:
    result = await verifier(chat_handler()).verify(
        ProviderVerifyRequest(provider_type="ollama")
    )

    assert result.status == "unconfigured"
    assert result.recoverable is True
    assert result.current_step == "config"
    assert [step.id for step in result.steps] == ["config"]


@pytest.mark.asyncio
async def test_connection_failure_maps_to_network_unreachable() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=request)

    result = await verifier(httpx.MockTransport(handler)).verify(
        ollama_request()
    )

    assert result.status == "failed"
    assert result.current_step == "connection"
    assert result.network_reachable is False
    assert result.recommended_action
    assert result.recoverable is True


@pytest.mark.asyncio
async def test_timeout_maps_to_connection_failure() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("read timeout", request=request)

    result = await verifier(httpx.MockTransport(handler)).verify(
        ollama_request()
    )

    assert result.status == "failed"
    assert result.current_step == "connection"
    assert result.network_reachable is False


@pytest.mark.asyncio
async def test_successful_local_llm_returns_ok() -> None:
    result = await verifier(chat_handler()).verify(ollama_request())

    assert result.status == "ok"
    assert result.current_step is None
    assert result.model_exists is True
    assert result.model_capabilities == ["chat"]
    assert result.first_response_latency_ms is not None
    assert result.network_reachable is True
    assert result.recoverable is False


@pytest.mark.asyncio
async def test_model_not_found_is_not_collapsed_to_network_unreachable() -> None:
    result = await verifier(chat_handler(chat_status=404)).verify(
        ollama_request()
    )

    assert result.status == "failed"
    assert result.current_step == "model"
    assert result.model_exists is False
    assert result.network_reachable is True
    detail = result.steps[-1].detail or ""
    assert "404" in detail
    assert "模型" in detail


@pytest.mark.asyncio
async def test_auth_failure_is_classified_as_credentials_not_network() -> None:
    result = await verifier(chat_handler(chat_status=401)).verify(
        ollama_request(api_key="sk-test")
    )

    assert result.status == "failed"
    assert result.current_step == "model"
    assert result.network_reachable is True
    detail = result.steps[-1].detail or ""
    assert "401" in detail or "认证" in detail
    assert "连接" not in result.steps[-1].label


@pytest.mark.asyncio
async def test_rate_limit_mentions_429_throttling() -> None:
    result = await verifier(chat_handler(chat_status=429)).verify(
        ollama_request()
    )

    assert result.status == "failed"
    detail = result.steps[-1].detail or ""
    assert "429" in detail or "限流" in detail


@pytest.mark.asyncio
async def test_feishu_without_credentials_returns_unconfigured() -> None:
    result = await verifier(chat_handler()).verify(
        ProviderVerifyRequest(provider_type="feishu")
    )

    assert result.status == "unconfigured"
    assert result.current_step == "config"
    assert result.recoverable is True


@pytest.mark.asyncio
async def test_feishu_permission_denied_maps_to_insufficient_permission() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/nodes"):
            return httpx.Response(403)
        return httpx.Response(200)

    result = await verifier(httpx.MockTransport(handler)).verify(
        ProviderVerifyRequest(
            provider_type="feishu",
            endpoint="https://open.feishu.cn",
            access_token="feishu-token",
            space_id="space-1",
        )
    )

    assert result.status == "failed"
    assert result.current_step == "permission"
    assert result.permission_status == "insufficient_permission"
    detail = result.steps[-1].detail or ""
    assert "403" in detail


@pytest.mark.asyncio
async def test_error_trace_id_is_propagated() -> None:
    result = await verifier(
        chat_handler(),
        trace_id="trace-abc-123",
    ).verify(ollama_request())

    assert result.error_trace_id == "trace-abc-123"


@pytest.mark.asyncio
async def test_partial_success_steps_are_preserved_before_failure() -> None:
    result = await verifier(chat_handler(chat_status=404)).verify(
        ollama_request()
    )

    assert [step.id for step in result.steps] == [
        "connection",
        "tls",
        "auth",
        "model",
    ]
    assert all(step.status == "pass" for step in result.steps[:-1])
    assert result.steps[-1].status == "fail"


@pytest.mark.asyncio
async def test_concurrent_verifications_do_not_cross_contaminate() -> None:
    ok_verifier = verifier(chat_handler())
    missing_verifier = verifier(chat_handler(chat_status=404))
    ok_request = ollama_request(model="qwen2.5")
    missing_request = ollama_request(model="does-not-exist")

    ok_result, missing_result = await asyncio.gather(
        ok_verifier.verify(ok_request),
        missing_verifier.verify(missing_request),
    )

    assert ok_result.status == "ok"
    assert ok_result.model_exists is True
    assert ok_result.model_capabilities == ["chat"]
    assert missing_result.status == "failed"
    assert missing_result.current_step == "model"
    assert missing_result.model_exists is False
