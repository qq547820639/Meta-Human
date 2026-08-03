from collections.abc import AsyncIterator
from pathlib import Path

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI, HTTPException, Response

from voxstudio_core.capabilities.base import CapabilityReady
from voxstudio_core.capabilities.fake import FakeCapabilityAdapter
from voxstudio_core.capabilities.registry import CapabilityAdapterRegistry
from voxstudio_core.capabilities.remote import (
    RemoteAvatarEnrollAdapter,
    RemoteAvatarStreamAdapter,
    RemoteTtsAdapter,
    RemoteVoiceEnrollAdapter,
)
from voxstudio_core.persistence.database import Database
from voxstudio_core.persistence.readiness_repository import ReadinessRepository
from voxstudio_core.providers.remote_gpu import RemoteGpuClient, RemoteGpuConfig
from voxstudio_core.readiness.models import (
    AggregateState,
    CapabilityId,
    CapabilityState,
    gate_open,
)
from voxstudio_core.readiness.service import ReadinessService


@pytest_asyncio.fixture
async def repository(tmp_path: Path) -> AsyncIterator[ReadinessRepository]:
    database = Database(tmp_path / "remote-provider.sqlite3")
    await database.connect()
    await database.migrate()
    try:
        yield ReadinessRepository(database)
    finally:
        await database.close()


def remote_registry(app: FastAPI) -> CapabilityAdapterRegistry:
    client = RemoteGpuClient(
        RemoteGpuConfig(base_url="https://gpu.test"),
        transport=httpx.ASGITransport(app=app),
    )
    adapters = {
        capability_id: FakeCapabilityAdapter(
            [CapabilityReady(safe_detail="Capability check passed.")]
        )
        for capability_id in CapabilityId
    }
    adapters[CapabilityId.TTS_SYNTHESIZE] = RemoteTtsAdapter(client)
    adapters[CapabilityId.VOICE_ENROLL] = RemoteVoiceEnrollAdapter(client)
    adapters[CapabilityId.AVATAR_ENROLL] = RemoteAvatarEnrollAdapter(client)
    adapters[CapabilityId.AVATAR_STREAM] = RemoteAvatarStreamAdapter(client)
    return CapabilityAdapterRegistry(adapters)


def stub_remote(
    *,
    fail_path: str | None = None,
    status: int = 503,
) -> FastAPI:
    app = FastAPI()

    @app.post("/v1/voice/enrollments")
    async def voice_enrollments() -> object:
        if fail_path == "/v1/voice/enrollments":
            raise HTTPException(status_code=status, detail="unavailable")
        return {"id": "voice-1"}

    @app.post("/v1/avatar/enrollments")
    async def avatar_enrollments() -> object:
        if fail_path == "/v1/avatar/enrollments":
            raise HTTPException(status_code=status, detail="unavailable")
        return {"id": "avatar-1"}

    @app.post("/v1/avatar/streams")
    async def avatar_streams() -> object:
        if fail_path == "/v1/avatar/streams":
            raise HTTPException(status_code=status, detail="unavailable")
        return {"session_id": "stream-1"}

    @app.post("/v1/audio/speech")
    async def audio_speech() -> Response:
        if fail_path == "/v1/audio/speech":
            raise HTTPException(status_code=status, detail="unavailable")
        return Response(content=b"RIFF-audio", media_type="audio/wav")

    return app


@pytest.mark.asyncio
async def test_remote_voice_avatar_adapters_open_the_gate(
    repository: ReadinessRepository,
) -> None:
    service = ReadinessService(
        repository=repository,
        registry=remote_registry(stub_remote()),
    )

    result = await service.prepare()

    assert result.state is AggregateState.READY
    assert gate_open(result.capabilities) is True
    assert all(
        capability.state is CapabilityState.READY
        for capability in result.capabilities
    )


@pytest.mark.asyncio
async def test_voice_access_rejection_keeps_gate_action_required(
    repository: ReadinessRepository,
) -> None:
    service = ReadinessService(
        repository=repository,
        registry=remote_registry(
            stub_remote(
                fail_path="/v1/voice/enrollments",
                status=401,
            )
        ),
    )

    result = await service.prepare()

    assert result.state is AggregateState.ACTION_REQUIRED
    assert gate_open(result.capabilities) is False
    voice = next(
        capability
        for capability in result.capabilities
        if capability.id is CapabilityId.VOICE_ENROLL
    )
    assert voice.state is CapabilityState.ACTION_REQUIRED
    assert voice.error is not None
    assert voice.error.code == "provider_access_required"


@pytest.mark.asyncio
async def test_avatar_stream_failure_fails_closed_as_degraded(
    repository: ReadinessRepository,
) -> None:
    service = ReadinessService(
        repository=repository,
        registry=remote_registry(
            stub_remote(
                fail_path="/v1/avatar/streams",
                status=503,
            )
        ),
    )

    result = await service.prepare()

    assert result.state is AggregateState.DEGRADED
    assert gate_open(result.capabilities) is False
    stream = next(
        capability
        for capability in result.capabilities
        if capability.id is CapabilityId.AVATAR_STREAM
    )
    assert stream.state is CapabilityState.DEGRADED
    assert stream.error is not None
    assert stream.error.code == "provider_unavailable"
    assert stream.error.retryable is True
