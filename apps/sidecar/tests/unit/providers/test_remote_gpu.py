import json

import httpx
import pytest
from pydantic import SecretStr, ValidationError

from voxstudio_core.providers.remote_gpu import (
    EmptyEnrollmentError,
    EmptyTtsError,
    RemoteGpuClient,
    RemoteGpuConfig,
)


def config() -> RemoteGpuConfig:
    return RemoteGpuConfig(
        base_url="https://gpu.example.com",
        api_key=SecretStr("secret-key"),
        tts_voice="sample-voice",
    )


def test_config_keeps_api_key_secret() -> None:
    value = config()

    assert value.api_key is not None
    assert value.api_key.get_secret_value() == "secret-key"
    assert "secret-key" not in repr(value)


@pytest.mark.parametrize(
    "url",
    (
        "ftp://gpu.example.com",
        "not a url",
        "https://user:pass@gpu.example.com",
    ),
)
def test_invalid_remote_base_urls_are_rejected(url: str) -> None:
    with pytest.raises(ValidationError):
        RemoteGpuConfig(base_url=url)


@pytest.mark.parametrize(
    "path",
    ("voice/enrollments", "/voice?x=1", "/voice#fragment"),
)
def test_provider_paths_must_be_absolute(path: str) -> None:
    with pytest.raises(ValidationError):
        RemoteGpuConfig(
            base_url="https://gpu.example.com",
            voice_enroll_path=path,
        )


@pytest.mark.asyncio
async def test_enroll_voice_uses_multipart_and_authorization() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={"id": "voice-123"})

    client = RemoteGpuClient(config(), transport=httpx.MockTransport(handler))

    voice_id = await client.enroll_voice(audio=b"RIFF-voice")

    assert voice_id == "voice-123"
    request = requests[0]
    assert str(request.url) == "https://gpu.example.com/v1/voice/enrollments"
    assert request.headers["authorization"] == "Bearer secret-key"
    assert request.headers["content-type"].startswith("multipart/form-data")


@pytest.mark.asyncio
async def test_enroll_avatar_returns_avatar_id() -> None:
    client = RemoteGpuClient(
        config(),
        transport=httpx.MockTransport(
            lambda _: httpx.Response(200, json={"avatar_id": "avatar-456"})
        ),
    )

    avatar_id = await client.enroll_avatar(image=b"PNG-avatar")

    assert avatar_id == "avatar-456"


@pytest.mark.asyncio
async def test_start_avatar_stream_returns_session_id() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(
            200,
            json={
                "session_id": "stream-789",
                "stream_url": "https://gpu.example.com/live/stream-789",
            },
        )

    client = RemoteGpuClient(config(), transport=httpx.MockTransport(handler))

    stream = await client.start_avatar_stream(
        avatar_id="avatar-456",
        voice_id="voice-123",
    )

    assert stream.session_id == "stream-789"
    assert stream.stream_url == "https://gpu.example.com/live/stream-789"
    payload = json.loads(requests[0].content)
    assert payload == {
        "avatar_id": "avatar-456",
        "voice_id": "voice-123",
    }


@pytest.mark.asyncio
async def test_stop_avatar_stream_uses_delete_with_session_id() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(204)

    client = RemoteGpuClient(config(), transport=httpx.MockTransport(handler))

    await client.stop_avatar_stream(session_id="stream-789")

    assert len(requests) == 1
    assert requests[0].method == "DELETE"
    assert str(requests[0].url) == (
        "https://gpu.example.com/v1/avatar/streams/stream-789"
    )


@pytest.mark.asyncio
async def test_synthesize_returns_audio_bytes() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(
            200,
            content=b"RIFF-audio",
            headers={"content-type": "audio/wav"},
        )

    client = RemoteGpuClient(config(), transport=httpx.MockTransport(handler))

    audio = await client.synthesize(text="hello")

    assert audio == b"RIFF-audio"
    payload = json.loads(requests[0].content)
    assert payload == {"input": "hello", "voice": "sample-voice"}


@pytest.mark.asyncio
async def test_enroll_rejects_missing_id() -> None:
    client = RemoteGpuClient(
        config(),
        transport=httpx.MockTransport(lambda _: httpx.Response(200, json={})),
    )

    with pytest.raises(EmptyEnrollmentError):
        await client.enroll_voice(audio=b"RIFF-voice")


@pytest.mark.asyncio
async def test_synthesize_rejects_empty_audio() -> None:
    client = RemoteGpuClient(
        config(),
        transport=httpx.MockTransport(
            lambda _: httpx.Response(
                200,
                content=b"",
                headers={"content-type": "audio/wav"},
            )
        ),
    )

    with pytest.raises(EmptyTtsError):
        await client.synthesize(text="hello")


@pytest.mark.asyncio
async def test_http_errors_are_propagated() -> None:
    client = RemoteGpuClient(
        config(),
        transport=httpx.MockTransport(lambda _: httpx.Response(503)),
    )

    with pytest.raises(httpx.HTTPStatusError):
        await client.enroll_voice(audio=b"RIFF-voice")
