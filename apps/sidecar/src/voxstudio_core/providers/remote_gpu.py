from dataclasses import dataclass

import httpx
from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator

from voxstudio_core.ssrf import validate_remote_base_url


class EmptyEnrollmentError(ValueError):
    pass


class EmptyStreamError(ValueError):
    pass


class EmptyTtsError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class AvatarStream:
    session_id: str
    stream_url: str | None = None


class RemoteGpuConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    base_url: str
    api_key: SecretStr | None = None
    voice_enroll_path: str = "/v1/voice/enrollments"
    avatar_enroll_path: str = "/v1/avatar/enrollments"
    avatar_stream_path: str = "/v1/avatar/streams"
    avatar_stream_stop_path: str = "/v1/avatar/streams/{session_id}"
    tts_path: str = "/v1/audio/speech"
    tts_voice: str | None = None
    timeout_seconds: float = Field(default=15.0, gt=0, le=120)
    max_media_bytes: int = Field(default=20_971_520, gt=0)

    @field_validator("base_url")
    @classmethod
    def normalize_base_url(cls, value: str) -> str:
        # Remote providers are outbound by nature, so apply the SSRF policy:
        # loopback, link-local (incl. cloud metadata), multicast and reserved
        # targets are rejected outright. Private RFC1918 (LAN) hosts remain
        # allowed for operators hosting services on the local network.
        return validate_remote_base_url(value)

    @field_validator(
        "voice_enroll_path",
        "avatar_enroll_path",
        "avatar_stream_path",
        "avatar_stream_stop_path",
        "tts_path",
    )
    @classmethod
    def validate_path(cls, value: str) -> str:
        if not value.startswith("/") or "?" in value or "#" in value:
            raise ValueError("provider path must be an absolute path")
        return value


class RemoteGpuClient:
    def __init__(
        self,
        config: RemoteGpuConfig,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._config = config
        self._transport = transport

    async def enroll_voice(
        self,
        *,
        audio: bytes,
        filename: str = "voice.wav",
    ) -> str:
        if len(audio) > self._config.max_media_bytes:
            raise ValueError("voice sample exceeds the media size limit")
        async with self._client() as client:
            response = await client.post(
                self._url(self._config.voice_enroll_path),
                files={"file": (filename, audio, "audio/wav")},
                headers=self._headers(),
            )
            response.raise_for_status()
            data = response.json()
            value = data.get("id") or data.get("voice_id")
            if not isinstance(value, str) or not value.strip():
                raise EmptyEnrollmentError("voice enrollment returned no id")
            return value.strip()

    async def enroll_avatar(
        self,
        *,
        image: bytes,
        filename: str = "avatar.png",
    ) -> str:
        if len(image) > self._config.max_media_bytes:
            raise ValueError("avatar sample exceeds the media size limit")
        async with self._client() as client:
            response = await client.post(
                self._url(self._config.avatar_enroll_path),
                files={"file": (filename, image, "image/png")},
                headers=self._headers(),
            )
            response.raise_for_status()
            data = response.json()
            value = data.get("id") or data.get("avatar_id")
            if not isinstance(value, str) or not value.strip():
                raise EmptyEnrollmentError("avatar enrollment returned no id")
            return value.strip()

    async def start_avatar_stream(
        self,
        *,
        avatar_id: str,
        voice_id: str,
    ) -> AvatarStream:
        async with self._client() as client:
            response = await client.post(
                self._url(self._config.avatar_stream_path),
                json={"avatar_id": avatar_id, "voice_id": voice_id},
                headers=self._headers(),
            )
            response.raise_for_status()
            data = response.json()
            value = data.get("session_id") or data.get("id")
            if not isinstance(value, str) or not value.strip():
                raise EmptyStreamError("avatar stream returned no session id")
            stream_url = data.get("stream_url") or data.get("url")
            return AvatarStream(
                session_id=value.strip(),
                stream_url=(
                    stream_url
                    if isinstance(stream_url, str) and stream_url.strip()
                    else None
                ),
            )

    async def stop_avatar_stream(self, *, session_id: str) -> None:
        async with self._client() as client:
            response = await client.delete(
                self._url(
                    self._config.avatar_stream_stop_path.replace(
                        "{session_id}",
                        session_id,
                    )
                ),
                headers=self._headers(),
            )
            response.raise_for_status()

    async def synthesize(self, *, text: str) -> bytes:
        payload: dict[str, str] = {"input": text}
        if self._config.tts_voice:
            payload["voice"] = self._config.tts_voice
        async with self._client() as client:
            response = await client.post(
                self._url(self._config.tts_path),
                json=payload,
                headers=self._headers(),
            )
            response.raise_for_status()
            if not response.content:
                raise EmptyTtsError("tts returned no audio")
            if response.headers.get("content-type", "").startswith(
                "application/json"
            ):
                raise ValueError("tts returned a JSON response instead of audio")
            return response.content

    def _url(self, path: str) -> str:
        return f"{self._config.base_url}{path}"

    def _headers(self) -> dict[str, str]:
        api_key = self._config.api_key
        if api_key is None:
            return {}
        return {"Authorization": f"Bearer {api_key.get_secret_value()}"}

    def _client(self) -> httpx.AsyncClient:
        total = self._config.timeout_seconds
        return httpx.AsyncClient(
            timeout=httpx.Timeout(
                connect=min(5.0, total),
                read=total,
                write=total,
                pool=min(5.0, total),
            ),
            transport=self._transport,
        )
