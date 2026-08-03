import json

import httpx
import pytest

from voxstudio_core.providers.local_config import LocalProviderConfig
from voxstudio_core.providers.openai_compatible import OpenAICompatibleClient


def config() -> LocalProviderConfig:
    return LocalProviderConfig(
        base_url="http://127.0.0.1:11434",
        chat_model="local-chat",
        embedding_model="local-embed",
    )


@pytest.mark.asyncio
async def test_chat_completion_uses_openai_compatible_contract() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "role": "assistant",
                            "content": "  ready  ",
                        }
                    }
                ]
            },
        )

    client = OpenAICompatibleClient(
        config(),
        transport=httpx.MockTransport(handler),
    )

    result = await client.chat_completion(model="local-chat", prompt="hello")

    assert result.text == "ready"
    request = requests[0]
    assert str(request.url) == "http://127.0.0.1:11434/v1/chat/completions"
    payload = json.loads(request.content)
    assert payload["model"] == "local-chat"
    assert payload["messages"] == [{"role": "user", "content": "hello"}]
    assert payload["stream"] is False


@pytest.mark.asyncio
async def test_embedding_returns_a_finite_vector() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == "http://127.0.0.1:11434/v1/embeddings"
        return httpx.Response(
            200,
            json={"data": [{"embedding": [0.1, -0.2, 0.3]}]},
        )

    client = OpenAICompatibleClient(
        config(),
        transport=httpx.MockTransport(handler),
    )

    result = await client.embedding(model="local-embed", input="hello")

    assert result.vector == (0.1, -0.2, 0.3)


@pytest.mark.asyncio
async def test_chat_completion_raises_http_status_errors() -> None:
    client = OpenAICompatibleClient(
        config(),
        transport=httpx.MockTransport(lambda _: httpx.Response(503)),
    )

    with pytest.raises(httpx.HTTPStatusError):
        await client.chat_completion(model="local-chat", prompt="hello")


@pytest.mark.asyncio
async def test_chat_completion_raises_on_invalid_json() -> None:
    client = OpenAICompatibleClient(
        config(),
        transport=httpx.MockTransport(
            lambda _: httpx.Response(200, text="not-json")
        ),
    )

    with pytest.raises(ValueError):
        await client.chat_completion(model="local-chat", prompt="hello")


@pytest.mark.asyncio
async def test_chat_completion_rejects_empty_content() -> None:
    client = OpenAICompatibleClient(
        config(),
        transport=httpx.MockTransport(
            lambda _: httpx.Response(
                200,
                json={"choices": [{"message": {"content": ""}}]},
            )
        ),
    )

    with pytest.raises(ValueError):
        await client.chat_completion(model="local-chat", prompt="hello")


@pytest.mark.asyncio
async def test_embedding_rejects_empty_vector() -> None:
    client = OpenAICompatibleClient(
        config(),
        transport=httpx.MockTransport(
            lambda _: httpx.Response(200, json={"data": [{"embedding": []}]})
        ),
    )

    with pytest.raises(ValueError):
        await client.embedding(model="local-embed", input="hello")


@pytest.mark.asyncio
async def test_transcription_returns_text_and_uses_multipart_form() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={"text": " ready "})

    client = OpenAICompatibleClient(
        config(),
        transport=httpx.MockTransport(handler),
    )

    text = await client.transcribe(
        model="local-stt",
        audio=b"RIFF-readiness",
    )

    assert text == "ready"
    request = requests[0]
    assert str(request.url) == "http://127.0.0.1:11434/v1/audio/transcriptions"
    assert request.headers["content-type"].startswith("multipart/form-data")


@pytest.mark.asyncio
async def test_transcription_rejects_empty_text() -> None:
    client = OpenAICompatibleClient(
        config(),
        transport=httpx.MockTransport(
            lambda _: httpx.Response(200, json={"text": ""})
        ),
    )

    with pytest.raises(ValueError):
        await client.transcribe(model="local-stt", audio=b"RIFF-readiness")
