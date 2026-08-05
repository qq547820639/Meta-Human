"""Contract tests for readiness response-structure validation.

A capability must not be judged "ready" merely because the HTTP connection
succeeded. HTML pages, proxy landing pages, empty responses and error
envelopes must all be classified as failures. These tests use mocked HTTP
transports, never the real network.
"""

from collections.abc import AsyncIterator

import httpx
import pytest

from voxstudio_core.capabilities.base import (
    CapabilityActionRequired,
    CapabilityCheckRequest,
    CapabilityReady,
    CapabilityTransientFailure,
    ResponseValidationError,
    validate_json_response,
)
from voxstudio_core.capabilities.local import LocalChatAdapter
from voxstudio_core.capabilities.remote import RemoteVoiceEnrollAdapter
from voxstudio_core.providers.local_config import LocalProviderConfig
from voxstudio_core.providers.openai_compatible import OpenAICompatibleClient
from voxstudio_core.providers.remote_gpu import RemoteGpuClient, RemoteGpuConfig
from voxstudio_core.readiness.models import CapabilityId


def request(capability: CapabilityId) -> CapabilityCheckRequest:
    return CapabilityCheckRequest(capability_id=capability, attempt=1)


def local_config(*, timeout_seconds: float = 5.0) -> LocalProviderConfig:
    return LocalProviderConfig(
        base_url="http://127.0.0.1:11434",
        chat_model="local-chat",
        embedding_model="local-embed",
        timeout_seconds=timeout_seconds,
    )


def local_client(transport: httpx.AsyncBaseTransport) -> OpenAICompatibleClient:
    return OpenAICompatibleClient(local_config(), transport=transport)


def remote_client(transport: httpx.AsyncBaseTransport) -> RemoteGpuClient:
    return RemoteGpuClient(
        RemoteGpuConfig(base_url="https://gpu.example.com"),
        transport=transport,
    )


# ---------------------------------------------------------------------------
# validate_json_response unit contract
# ---------------------------------------------------------------------------


def test_validate_rejects_html_page() -> None:
    response = httpx.Response(
        200,
        text="<html><body>proxy login</body></html>",
        headers={"content-type": "text/html; charset=utf-8"},
    )

    validation = validate_json_response(response, service="测试")

    assert validation.ok is False
    assert validation.step == "content_type"
    assert validation.code == "html_response"
    assert "网页" in validation.message


def test_validate_rejects_empty_body() -> None:
    response = httpx.Response(
        200,
        content=b"",
        headers={"content-type": "application/json"},
    )

    validation = validate_json_response(response, service="测试")

    assert validation.ok is False
    assert validation.code == "empty_response"


def test_validate_rejects_error_envelope() -> None:
    response = httpx.Response(200, json={"error": {"message": "invalid api key"}})

    validation = validate_json_response(response, service="测试")

    assert validation.ok is False
    assert validation.step == "error_envelope"
    assert validation.code == "provider_error"
    assert "invalid api key" in validation.message


def test_validate_rejects_non_json_content_type() -> None:
    response = httpx.Response(
        200,
        text="ok",
        headers={"content-type": "text/plain"},
    )

    validation = validate_json_response(response, service="测试")

    assert validation.ok is False
    assert validation.code == "non_json_response"


def test_validate_rejects_invalid_json_body() -> None:
    response = httpx.Response(
        200,
        content=b"not-json",
        headers={"content-type": "application/json"},
    )

    validation = validate_json_response(response, service="测试")

    assert validation.ok is False
    assert validation.code == "invalid_json"


def test_validate_reports_missing_required_field() -> None:
    response = httpx.Response(200, json={"unrelated": 1})

    validation = validate_json_response(
        response, service="测试", required_fields=("choices",)
    )

    assert validation.ok is False
    assert validation.code == "missing_field"


def test_validate_rejects_non_2xx_status() -> None:
    response = httpx.Response(503, json={"error": "down"})

    validation = validate_json_response(response, service="测试")

    assert validation.ok is False
    assert validation.code == "http_status_error"


def test_validate_accepts_valid_json() -> None:
    response = httpx.Response(200, json={"choices": []})

    validation = validate_json_response(
        response, service="测试", required_fields=("choices",)
    )

    assert validation.ok is True


def test_validate_allows_vendor_json_content_type() -> None:
    response = httpx.Response(
        200,
        content=b'{"choices":[]}',
        headers={"content-type": "application/vnd.api+json"},
    )

    validation = validate_json_response(
        response, service="测试", required_fields=("choices",)
    )

    assert validation.ok is True


# ---------------------------------------------------------------------------
# Adapter-level wiring: structural failures are never CapabilityReady
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_chat_adapter_flags_html_answer_as_action() -> None:
    adapter = LocalChatAdapter(
        local_client(
            httpx.MockTransport(
                lambda _: httpx.Response(
                    200,
                    text="<html><body>landing</body></html>",
                    headers={"content-type": "text/html; charset=utf-8"},
                )
            )
        ),
        "local-chat",
    )

    outcome = await adapter.check(request(CapabilityId.LLM_CHAT))

    assert isinstance(outcome, CapabilityActionRequired)
    assert outcome.code == "html_response"
    assert not isinstance(outcome, CapabilityReady)


@pytest.mark.asyncio
async def test_chat_adapter_flags_error_envelope_as_action() -> None:
    adapter = LocalChatAdapter(
        local_client(
            httpx.MockTransport(
                lambda _: httpx.Response(
                    200,
                    json={"error": {"message": "invalid api key"}},
                )
            )
        ),
        "local-chat",
    )

    outcome = await adapter.check(request(CapabilityId.LLM_CHAT))

    assert isinstance(outcome, CapabilityActionRequired)
    assert outcome.code == "provider_error"


@pytest.mark.asyncio
async def test_chat_adapter_flags_empty_body_as_action() -> None:
    adapter = LocalChatAdapter(
        local_client(
            httpx.MockTransport(
                lambda _: httpx.Response(
                    200,
                    content=b"",
                    headers={"content-type": "application/json"},
                )
            )
        ),
        "local-chat",
    )

    outcome = await adapter.check(request(CapabilityId.LLM_CHAT))

    assert isinstance(outcome, CapabilityActionRequired)
    assert outcome.code == "empty_response"


@pytest.mark.asyncio
async def test_chat_adapter_maps_rate_limit_429() -> None:
    adapter = LocalChatAdapter(
        local_client(httpx.MockTransport(lambda _: httpx.Response(429))),
        "local-chat",
    )

    outcome = await adapter.check(request(CapabilityId.LLM_CHAT))

    assert isinstance(outcome, CapabilityTransientFailure)
    assert outcome.code == "provider_rate_limited"


@pytest.mark.asyncio
async def test_chat_adapter_maps_connection_failure() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=request)

    adapter = LocalChatAdapter(
        local_client(httpx.MockTransport(handler)),
        "local-chat",
    )

    outcome = await adapter.check(request(CapabilityId.LLM_CHAT))

    assert isinstance(outcome, CapabilityActionRequired)
    assert outcome.code == "provider_unreachable"


@pytest.mark.asyncio
async def test_remote_adapter_maps_not_found_404() -> None:
    adapter = RemoteVoiceEnrollAdapter(
        remote_client(httpx.MockTransport(lambda _: httpx.Response(404)))
    )

    outcome = await adapter.check(request(CapabilityId.VOICE_ENROLL))

    assert isinstance(outcome, CapabilityActionRequired)
    assert outcome.code == "provider_not_found"


@pytest.mark.asyncio
async def test_remote_adapter_maps_rate_limit_429() -> None:
    adapter = RemoteVoiceEnrollAdapter(
        remote_client(httpx.MockTransport(lambda _: httpx.Response(429)))
    )

    outcome = await adapter.check(request(CapabilityId.VOICE_ENROLL))

    assert isinstance(outcome, CapabilityTransientFailure)
    assert outcome.code == "provider_rate_limited"


# ---------------------------------------------------------------------------
# Streaming contract
# ---------------------------------------------------------------------------


def _sse(body: str) -> httpx.MockTransport:
    return httpx.MockTransport(
        lambda _: httpx.Response(
            200,
            content=body.encode("utf-8"),
            headers={"content-type": "text/event-stream"},
        )
    )


@pytest.mark.asyncio
async def test_stream_yields_incremental_text() -> None:
    body = (
        'data: {"choices":[{"delta":{"content":"hel"}}]}\n\n'
        'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n'
        "data: [DONE]\n\n"
    )
    client = OpenAICompatibleClient(
        local_config(), transport=_sse(body)
    )

    chunks = [
        chunk
        async for chunk in client.chat_completion_stream(
            model="local-chat", prompt="hi"
        )
    ]

    assert "".join(chunks) == "hello"


@pytest.mark.asyncio
async def test_stream_skips_malformed_chunks_and_missing_choices() -> None:
    body = (
        "data: not-valid-json\n\n"
        'data: {"choices":[]}\n\n'
        'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n'
        "data: [DONE]\n\n"
    )
    client = OpenAICompatibleClient(local_config(), transport=_sse(body))

    chunks = [
        chunk
        async for chunk in client.chat_completion_stream(
            model="local-chat", prompt="hi"
        )
    ]

    assert "".join(chunks) == "ok"


@pytest.mark.asyncio
async def test_stream_rejects_html_landing_page() -> None:
    client = OpenAICompatibleClient(
        local_config(),
        transport=httpx.MockTransport(
            lambda _: httpx.Response(
                200,
                text="<html><body>landing</body></html>",
                headers={"content-type": "text/html; charset=utf-8"},
            )
        ),
    )

    with pytest.raises(ResponseValidationError):
        async for _ in client.chat_completion_stream(
            model="local-chat", prompt="hi"
        ):
            pass


class _DisconnectingStream(httpx.AsyncByteStream):
    def __init__(self, request: httpx.Request) -> None:
        self._request = request

    async def __aiter__(self) -> AsyncIterator[bytes]:
        yield b'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n'
        raise httpx.ReadError(
            "connection dropped mid-stream", request=self._request
        )

    async def aclose(self) -> None:
        return None


class DisconnectingTransport(httpx.AsyncBaseTransport):
    """A transport that drops the stream mid-way, after one valid chunk."""

    async def handle_async_request(
        self, request: httpx.Request
    ) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"content-type": "text/event-stream"},
            stream=_DisconnectingStream(request),
            request=request,
        )


@pytest.mark.asyncio
async def test_stream_propagates_mid_stream_disconnect() -> None:
    client = OpenAICompatibleClient(
        local_config(), transport=DisconnectingTransport()
    )

    with pytest.raises(httpx.ReadError):
        async for _ in client.chat_completion_stream(
            model="local-chat", prompt="hi"
        ):
            pass


# ---------------------------------------------------------------------------
# Staged timeouts
# ---------------------------------------------------------------------------


def test_client_uses_staged_timeouts() -> None:
    client = OpenAICompatibleClient(
        local_config(timeout_seconds=20.0),
        transport=httpx.MockTransport(lambda _: httpx.Response(204)),
    )

    timeout = client._client().timeout

    # connect/pool are capped so a hung handshake fails fast; read/write use
    # the configured budget.
    assert timeout.connect == 5.0
    assert timeout.pool == 5.0
    assert timeout.read == 20.0
    assert timeout.write == 20.0
