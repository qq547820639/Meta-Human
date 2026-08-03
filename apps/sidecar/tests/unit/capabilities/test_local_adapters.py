import httpx
import pytest

from voxstudio_core.capabilities.base import (
    CapabilityActionRequired,
    CapabilityCheckRequest,
    CapabilityReady,
    CapabilityTransientFailure,
)
from voxstudio_core.capabilities.local import (
    LocalChatAdapter,
    LocalEmbeddingAdapter,
    LocalSttAdapter,
)
from voxstudio_core.providers.local_config import LocalProviderConfig
from voxstudio_core.providers.openai_compatible import OpenAICompatibleClient
from voxstudio_core.readiness.models import CapabilityId


def config() -> LocalProviderConfig:
    return LocalProviderConfig(
        base_url="http://127.0.0.1:11434",
        chat_model="local-chat",
        embedding_model="local-embed",
    )


def request(capability: CapabilityId) -> CapabilityCheckRequest:
    return CapabilityCheckRequest(capability_id=capability, attempt=1)


def client(handler: httpx.MockTransport) -> OpenAICompatibleClient:
    return OpenAICompatibleClient(config(), transport=handler)


@pytest.mark.asyncio
async def test_chat_adapter_returns_ready_for_a_real_reply() -> None:
    adapter = LocalChatAdapter(
        client(
            httpx.MockTransport(
                lambda _: httpx.Response(
                    200,
                    json={"choices": [{"message": {"content": "ready"}}]},
                )
            )
        ),
        "local-chat",
    )

    outcome = await adapter.check(request(CapabilityId.LLM_CHAT))

    assert outcome == CapabilityReady(
        safe_detail="The local chat model answered a readiness prompt."
    )


@pytest.mark.asyncio
async def test_chat_adapter_maps_server_failure_to_transient_error() -> None:
    adapter = LocalChatAdapter(
        client(httpx.MockTransport(lambda _: httpx.Response(503))),
        "local-chat",
    )

    outcome = await adapter.check(request(CapabilityId.LLM_CHAT))

    assert isinstance(outcome, CapabilityTransientFailure)
    assert outcome.code == "provider_unavailable"
    assert outcome.safe_detail == (
        "The chat readiness check could not be completed."
    )


@pytest.mark.asyncio
async def test_chat_adapter_maps_access_rejection_to_action() -> None:
    adapter = LocalChatAdapter(
        client(httpx.MockTransport(lambda _: httpx.Response(401))),
        "local-chat",
    )

    outcome = await adapter.check(request(CapabilityId.LLM_CHAT))

    assert isinstance(outcome, CapabilityActionRequired)
    assert outcome.code == "provider_access_required"
    assert outcome.recommended_action.startswith("Check local model service")


@pytest.mark.asyncio
async def test_chat_adapter_maps_timeout_to_transient_error() -> None:
    def timeout_handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectTimeout("timed out", request=request)

    adapter = LocalChatAdapter(
        client(httpx.MockTransport(timeout_handler)),
        "local-chat",
    )

    outcome = await adapter.check(request(CapabilityId.LLM_CHAT))

    assert isinstance(outcome, CapabilityTransientFailure)
    assert outcome.code == "provider_timeout"


@pytest.mark.asyncio
async def test_chat_adapter_maps_invalid_response_to_transient_error() -> None:
    adapter = LocalChatAdapter(
        client(httpx.MockTransport(lambda _: httpx.Response(200, text="bad"))),
        "local-chat",
    )

    outcome = await adapter.check(request(CapabilityId.LLM_CHAT))

    assert isinstance(outcome, CapabilityTransientFailure)
    assert outcome.code == "invalid_provider_response"


@pytest.mark.asyncio
async def test_chat_adapter_maps_empty_reply_to_action() -> None:
    adapter = LocalChatAdapter(
        client(
            httpx.MockTransport(
                lambda _: httpx.Response(
                    200,
                    json={"choices": [{"message": {"content": ""}}]},
                )
            )
        ),
        "local-chat",
    )

    outcome = await adapter.check(request(CapabilityId.LLM_CHAT))

    assert isinstance(outcome, CapabilityActionRequired)
    assert outcome.code == "empty_provider_response"


@pytest.mark.asyncio
async def test_embedding_adapter_returns_ready_for_a_finite_vector() -> None:
    adapter = LocalEmbeddingAdapter(
        client(
            httpx.MockTransport(
                lambda _: httpx.Response(
                    200,
                    json={"data": [{"embedding": [0.1, 0.2, 0.3]}]},
                )
            )
        ),
        "local-embed",
    )

    outcome = await adapter.check(request(CapabilityId.EMBEDDING_TEXT))

    assert outcome == CapabilityReady(
        safe_detail="The local embedding model returned a finite vector."
    )


@pytest.mark.asyncio
async def test_embedding_adapter_maps_service_failure_to_transient_error() -> None:
    adapter = LocalEmbeddingAdapter(
        client(httpx.MockTransport(lambda _: httpx.Response(500))),
        "local-embed",
    )

    outcome = await adapter.check(request(CapabilityId.EMBEDDING_TEXT))

    assert isinstance(outcome, CapabilityTransientFailure)
    assert outcome.code == "provider_unavailable"


@pytest.mark.asyncio
async def test_stt_adapter_returns_ready_for_a_real_transcription() -> None:
    adapter = LocalSttAdapter(
        client(
            httpx.MockTransport(
                lambda _: httpx.Response(200, json={"text": "ready"})
            )
        ),
        "local-stt",
    )

    outcome = await adapter.check(request(CapabilityId.STT_TRANSCRIBE))

    assert outcome == CapabilityReady(
        safe_detail="The local STT model transcribed the readiness sample."
    )


@pytest.mark.asyncio
async def test_stt_adapter_returns_action_when_model_is_missing() -> None:
    adapter = LocalSttAdapter(
        client(httpx.MockTransport(lambda _: httpx.Response(500))),
        None,
    )

    outcome = await adapter.check(request(CapabilityId.STT_TRANSCRIBE))

    assert isinstance(outcome, CapabilityActionRequired)
    assert outcome.code == "stt_provider_not_configured"


@pytest.mark.asyncio
async def test_stt_adapter_maps_empty_transcription_to_action() -> None:
    adapter = LocalSttAdapter(
        client(
            httpx.MockTransport(
                lambda _: httpx.Response(200, json={"text": ""})
            )
        ),
        "local-stt",
    )

    outcome = await adapter.check(request(CapabilityId.STT_TRANSCRIBE))

    assert isinstance(outcome, CapabilityActionRequired)
    assert outcome.code == "empty_stt_response"


@pytest.mark.asyncio
async def test_stt_adapter_maps_service_failure_to_transient_error() -> None:
    adapter = LocalSttAdapter(
        client(httpx.MockTransport(lambda _: httpx.Response(503))),
        "local-stt",
    )

    outcome = await adapter.check(request(CapabilityId.STT_TRANSCRIBE))

    assert isinstance(outcome, CapabilityTransientFailure)
    assert outcome.code == "provider_unavailable"


@pytest.mark.asyncio
async def test_stt_adapter_maps_access_rejection_to_action() -> None:
    adapter = LocalSttAdapter(
        client(httpx.MockTransport(lambda _: httpx.Response(401))),
        "local-stt",
    )

    outcome = await adapter.check(request(CapabilityId.STT_TRANSCRIBE))

    assert isinstance(outcome, CapabilityActionRequired)
    assert outcome.code == "provider_access_required"
