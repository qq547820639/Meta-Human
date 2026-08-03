from dataclasses import dataclass
from pathlib import Path

from voxstudio_core.providers.remote_gpu import RemoteGpuClient


class AvatarBuildUnavailableError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class AvatarBuildResult:
    voice_id: str
    avatar_id: str


class AvatarBuildService:
    def __init__(
        self,
        *,
        client: RemoteGpuClient,
        max_portrait_bytes: int = 20_971_520,
        max_recording_bytes: int = 25_165_824,
    ) -> None:
        self._client = client
        self._max_portrait_bytes = max_portrait_bytes
        self._max_recording_bytes = max_recording_bytes

    async def build(
        self,
        *,
        portrait_path: str,
        recording_path: str,
    ) -> AvatarBuildResult:
        portrait = _read_media(Path(portrait_path), self._max_portrait_bytes)
        recording = _read_media(Path(recording_path), self._max_recording_bytes)
        try:
            voice_id = await self._client.enroll_voice(audio=recording)
            avatar_id = await self._client.enroll_avatar(image=portrait)
        except Exception as error:
            raise AvatarBuildUnavailableError(str(error)) from error
        return AvatarBuildResult(voice_id=voice_id, avatar_id=avatar_id)


def _read_media(path: Path, max_bytes: int) -> bytes:
    if not path.is_file():
        raise AvatarBuildUnavailableError(f"media file is missing: {path}")
    data = path.read_bytes()
    if len(data) > max_bytes:
        raise AvatarBuildUnavailableError("media file exceeds the size limit")
    return data
