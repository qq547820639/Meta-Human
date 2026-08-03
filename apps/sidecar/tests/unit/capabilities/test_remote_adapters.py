import httpx
import pytest

from voxstudio_core.capabilities.base import (
    CapabilityActionRequired,
    CapabilityCheckRequest,
    CapabilityReady,
    CapabilityTransientFailure,
)
from voxstudio_core.capabilities.remote import (
    RemoteAvatarEnrollAdapter,
    RemoteAvatarStreamAdapter,
    RemoteTtsAdapter,
    RemoteVoiceEnrollAdapter,
)
from voxstudio_core.providers.remote_gpu import RemoteGpuClient, RemoteGpuConfig
from voxstudio_core.readiness.models import CapabilityId


def client(handler: httpx.MockTransport) -> RemoteGpuClient:
    return RemoteGpuClient(
        RemoteGpuConfig(base_url="https://gpu.example.com"),
        transport=handler,
    )


def request(capability: CapabilityId) -> CapabilityCheckRequest:
    return CapabilityCheckRequest(capability_id=capability, attempt=1)


def ready_handler(path: str, payload: object) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == path
        return httpx.Response(200, json=payload)

    return httpx.MockTransport(handler)


@pytest.mark.asyncio
async def test_voice_enroll_adapter_returns_ready() -> None:
    adapter = RemoteVoiceEnrollAdapter(
        client(ready_handler("/v1/voice/enrollments", {"id": "voice-1"}))
    )

    outcome = await adapter.check(request(CapabilityId.VOICE_ENROLL))

    assert outcome == CapabilityReady(
        safe_detail="The remote voice service enrolled the readiness sample."
    )


@pytest.mark.asyncio
async def test_avatar_enroll_adapter_returns_ready() -> None:
    adapter = RemoteAvatarEnrollAdapter(
        client(ready_handler("/v1/avatar/enrollments", {"id": "avatar-1"}))
    )

    outcome = await adapter.check(request(CapabilityId.AVATAR_ENROLL))

    assert outcome == CapabilityReady(
        safe_detail="The remote avatar service enrolled the readiness sample."
    )


@pytest.mark.asyncio
async def test_avatar_stream_adapter_returns_ready_after_end_to_end_enrollment() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path == "/v1/voice/enrollments":
            return httpx.Response(200, json={"id": "voice-1"})
        if request.url.path == "/v1/avatar/enrollments":
            return httpx.Response(200, json={"id": "avatar-1"})
        if request.url.path == "/v1/avatar/streams":
            return httpx.Response(200, json={"session_id": "stream-1"})
        if (
            request.method == "DELETE"
            and request.url.path == "/v1/avatar/streams/stream-1"
        ):
            return httpx.Response(204)
        raise AssertionError(f"unexpected path {request.url.path}")

    adapter = RemoteAvatarStreamAdapter(client(httpx.MockTransport(handler)))

    outcome = await adapter.check(request(CapabilityId.AVATAR_STREAM))

    assert outcome == CapabilityReady(
        safe_detail="The remote avatar service started a readiness stream."
    )
    assert any(
        request.method == "DELETE"
        and request.url.path == "/v1/avatar/streams/stream-1"
        for request in requests
    )


@pytest.mark.asyncio
async def test_tts_adapter_returns_ready_for_audio() -> None:
    adapter = RemoteTtsAdapter(
        client(
            httpx.MockTransport(
                lambda _: httpx.Response(
                    200,
                    content=b"RIFF-audio",
                    headers={"content-type": "audio/wav"},
                )
            )
        )
    )

    outcome = await adapter.check(request(CapabilityId.TTS_SYNTHESIZE))

    assert outcome == CapabilityReady(
        safe_detail="The remote TTS service synthesized a readiness sample."
    )


@pytest.mark.asyncio
async def test_voice_enroll_maps_access_rejection_to_action() -> None:
    adapter = RemoteVoiceEnrollAdapter(
        client(httpx.MockTransport(lambda _: httpx.Response(401)))
    )

    outcome = await adapter.check(request(CapabilityId.VOICE_ENROLL))

    assert isinstance(outcome, CapabilityActionRequired)
    assert outcome.code == "provider_access_required"


@pytest.mark.asyncio
async def test_tts_maps_service_failure_to_transient_error() -> None:
    adapter = RemoteTtsAdapter(
        client(httpx.MockTransport(lambda _: httpx.Response(503)))
    )

    outcome = await adapter.check(request(CapabilityId.TTS_SYNTHESIZE))

    assert isinstance(outcome, CapabilityTransientFailure)
    assert outcome.code == "provider_unavailable"
