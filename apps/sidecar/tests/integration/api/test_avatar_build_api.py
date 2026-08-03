from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import pytest
from httpx import ASGITransport, AsyncClient

from voxstudio_core.api.app import create_app
from voxstudio_core.config import SidecarConfig, generate_startup_token
from voxstudio_core.providers.avatar_build import (
    AvatarBuildResult,
    AvatarBuildUnavailableError,
)
from voxstudio_core.providers.remote_gpu import AvatarStream


class StubAvatarBuildService:
    def __init__(self, *, fail: bool = False) -> None:
        self.fail = fail

    async def build(
        self,
        *,
        portrait_path: str,
        recording_path: str,
    ) -> AvatarBuildResult:
        if self.fail:
            raise AvatarBuildUnavailableError("remote build unavailable")
        return AvatarBuildResult(voice_id="voice-1", avatar_id="avatar-1")


class StubStreamClient:
    def __init__(self) -> None:
        self.stopped: list[str] = []

    async def start_avatar_stream(
        self,
        *,
        avatar_id: str,
        voice_id: str,
    ) -> AvatarStream:
        return AvatarStream(
            session_id="stream-1",
            stream_url="https://gpu.example.com/live/stream-1",
        )

    async def stop_avatar_stream(self, *, session_id: str) -> None:
        self.stopped.append(session_id)


class EmptyLifecycle:
    async def startup(self) -> None:
        return None

    async def shutdown(self) -> None:
        return None

    async def current_run(self):
        return None

    async def start_or_resume(self):
        return None


@asynccontextmanager
async def running_client(
    token: str,
    service: StubAvatarBuildService,
    stream_client: StubStreamClient | None = None,
) -> AsyncIterator[AsyncClient]:
    app = create_app(
        config=SidecarConfig(bearer_token=token),
        lifecycle=EmptyLifecycle(),
        avatar_build_service=service,
        avatar_stream_client=stream_client,
    )
    async with app.router.lifespan_context(app):
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://sidecar.test",
        ) as client:
            yield client


def authorization(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_avatar_build_returns_voice_and_avatar_ids() -> None:
    token = generate_startup_token()
    async with running_client(token, StubAvatarBuildService()) as client:
        response = await client.post(
            "/v1/avatar/builds",
            headers=authorization(token),
            json={
                "portrait_path": "/tmp/portrait.jpg",
                "recording_path": "/tmp/voice.wav",
            },
        )

    assert response.status_code == 200
    assert response.json() == {
        "voice_id": "voice-1",
        "avatar_id": "avatar-1",
    }


@pytest.mark.asyncio
async def test_avatar_build_fails_closed_on_provider_error() -> None:
    token = generate_startup_token()
    async with running_client(
        token,
        StubAvatarBuildService(fail=True),
    ) as client:
        response = await client.post(
            "/v1/avatar/builds",
            headers=authorization(token),
            json={
                "portrait_path": "/tmp/portrait.jpg",
                "recording_path": "/tmp/voice.wav",
            },
        )

    assert response.status_code == 503


@pytest.mark.asyncio
async def test_avatar_build_requires_bearer_token() -> None:
    token = generate_startup_token()
    async with running_client(token, StubAvatarBuildService()) as client:
        response = await client.post(
            "/v1/avatar/builds",
            json={
                "portrait_path": "/tmp/portrait.jpg",
                "recording_path": "/tmp/voice.wav",
            },
        )

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_avatar_stream_start_and_stop_are_wired() -> None:
    token = generate_startup_token()
    stream_client = StubStreamClient()
    async with running_client(
        token,
        StubAvatarBuildService(),
        stream_client,
    ) as client:
        start = await client.post(
            "/v1/avatar/streams",
            headers=authorization(token),
            json={
                "avatar_id": "avatar-1",
                "voice_id": "voice-1",
            },
        )
        stop = await client.delete(
            "/v1/avatar/streams/stream-1",
            headers=authorization(token),
        )

    assert start.status_code == 200
    assert start.json() == {
        "session_id": "stream-1",
        "stream_url": "https://gpu.example.com/live/stream-1",
    }
    assert stop.status_code == 204
    assert stream_client.stopped == ["stream-1"]


@pytest.mark.asyncio
async def test_avatar_stream_routes_require_bearer_token() -> None:
    token = generate_startup_token()
    async with running_client(
        token,
        StubAvatarBuildService(),
        StubStreamClient(),
    ) as client:
        start = await client.post(
            "/v1/avatar/streams",
            json={
                "avatar_id": "avatar-1",
                "voice_id": "voice-1",
            },
        )
        stop = await client.delete("/v1/avatar/streams/stream-1")

    assert start.status_code == 401
    assert stop.status_code == 401
