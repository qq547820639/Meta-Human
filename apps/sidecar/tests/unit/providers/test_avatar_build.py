from pathlib import Path

import httpx
import pytest

from voxstudio_core.providers.avatar_build import (
    AvatarBuildService,
    AvatarBuildResult,
    AvatarBuildUnavailableError,
)
from voxstudio_core.providers.remote_gpu import RemoteGpuClient, RemoteGpuConfig


def client(handler: httpx.MockTransport) -> RemoteGpuClient:
    return RemoteGpuClient(
        RemoteGpuConfig(base_url="https://gpu.example.com"),
        transport=handler,
    )


@pytest.mark.asyncio
async def test_build_reads_media_and_enrolls_voice_and_avatar(
    tmp_path: Path,
) -> None:
    portrait = tmp_path / "portrait.jpg"
    recording = tmp_path / "voice.wav"
    portrait.write_bytes(b"JPEG-portrait")
    recording.write_bytes(b"WAV-recording")

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/voice/enrollments":
            return httpx.Response(200, json={"id": "voice-1"})
        if request.url.path == "/v1/avatar/enrollments":
            return httpx.Response(200, json={"id": "avatar-1"})
        raise AssertionError(f"unexpected path {request.url.path}")

    service = AvatarBuildService(client=client(httpx.MockTransport(handler)))

    result = await service.build(
        portrait_path=str(portrait),
        recording_path=str(recording),
    )

    assert result == AvatarBuildResult(voice_id="voice-1", avatar_id="avatar-1")


@pytest.mark.asyncio
async def test_build_fails_closed_when_media_is_missing(
    tmp_path: Path,
) -> None:
    service = AvatarBuildService(
        client=client(httpx.MockTransport(lambda _: httpx.Response(500)))
    )

    with pytest.raises(AvatarBuildUnavailableError, match="missing"):
        await service.build(
            portrait_path=str(tmp_path / "missing.jpg"),
            recording_path=str(tmp_path / "voice.wav"),
        )


@pytest.mark.asyncio
async def test_build_fails_closed_when_media_is_too_large(
    tmp_path: Path,
) -> None:
    portrait = tmp_path / "portrait.jpg"
    recording = tmp_path / "voice.wav"
    portrait.write_bytes(b"xx")
    recording.write_bytes(b"yy")

    service = AvatarBuildService(
        client=client(httpx.MockTransport(lambda _: httpx.Response(500))),
        max_portrait_bytes=1,
        max_recording_bytes=1,
    )

    with pytest.raises(AvatarBuildUnavailableError, match="size limit"):
        await service.build(
            portrait_path=str(portrait),
            recording_path=str(recording),
        )
