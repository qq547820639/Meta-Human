from pathlib import Path

import httpx

from voxstudio_core.capabilities.base import (
    CapabilityActionRequired,
    CapabilityCheckOutcome,
    CapabilityCheckRequest,
    CapabilityReady,
    CapabilityTransientFailure,
)
from voxstudio_core.providers.remote_gpu import (
    EmptyEnrollmentError,
    EmptyStreamError,
    EmptyTtsError,
    RemoteGpuClient,
)

READINESS_PROMPT = "Reply with the single word: ready"
VOICE_SAMPLE_PATH = (
    Path(__file__).resolve().parent.parent
    / "assets"
    / "readiness"
    / "stt_sample.wav"
)
AVATAR_SAMPLE_PATH = (
    Path(__file__).resolve().parent.parent
    / "assets"
    / "readiness"
    / "avatar_sample.png"
)


def _access_action(service: str) -> CapabilityActionRequired:
    return CapabilityActionRequired(
        code="provider_access_required",
        message=f"The remote {service} service rejected access.",
        recommended_action="Check remote GPU service access settings and try again.",
        safe_detail=f"The remote {service} readiness check was rejected.",
    )


def _unavailable(service: str) -> CapabilityTransientFailure:
    return CapabilityTransientFailure(
        code="provider_unavailable",
        message=f"The remote {service} service is unavailable.",
        safe_detail=f"The remote {service} readiness check could not be completed.",
    )


def _invalid(service: str) -> CapabilityTransientFailure:
    return CapabilityTransientFailure(
        code="invalid_provider_response",
        message=f"The remote {service} service returned an invalid response.",
        safe_detail=f"The remote {service} readiness response was invalid.",
    )


def _timeout(service: str) -> CapabilityTransientFailure:
    return CapabilityTransientFailure(
        code="provider_timeout",
        message=f"The remote {service} service did not answer in time.",
        safe_detail=f"The remote {service} readiness check timed out.",
    )


def _not_found(service: str) -> CapabilityActionRequired:
    return CapabilityActionRequired(
        code="provider_not_found",
        message=f"远程{service}接口不存在（404），请检查服务地址是否正确。",
        recommended_action="请检查远程服务地址与接口路径后重试。",
        safe_detail=f"The remote {service} readiness endpoint was not found.",
    )


def _rate_limited(service: str) -> CapabilityTransientFailure:
    return CapabilityTransientFailure(
        code="provider_rate_limited",
        message=f"远程{service}服务请求过于频繁（429），请稍后重试。",
        safe_detail=f"The remote {service} readiness check was rate limited.",
    )


def _http_status_error(
    error: httpx.HTTPStatusError,
    *,
    service: str,
) -> CapabilityCheckOutcome:
    status = error.response.status_code
    if status in {401, 403}:
        return _access_action(service)
    if status == 404:
        return _not_found(service)
    if status == 429:
        return _rate_limited(service)
    return _unavailable(service)


class RemoteVoiceEnrollAdapter:
    def __init__(
        self,
        client: RemoteGpuClient,
        *,
        sample_path: Path = VOICE_SAMPLE_PATH,
    ) -> None:
        self._client = client
        self._sample_path = sample_path

    async def check(
        self,
        request: CapabilityCheckRequest,
    ) -> CapabilityCheckOutcome:
        del request
        if not self._sample_path.is_file():
            return CapabilityActionRequired(
                code="voice_sample_missing",
                message="The bundled voice sample is missing.",
                recommended_action="Reinstall the application and try again.",
                safe_detail="Voice enrollment readiness cannot find its sample.",
            )
        try:
            await self._client.enroll_voice(
                audio=self._sample_path.read_bytes(),
            )
        except EmptyEnrollmentError:
            return CapabilityActionRequired(
                code="empty_provider_response",
                message="The remote voice service returned no enrollment id.",
                recommended_action="Start the remote voice service and try again.",
                safe_detail="Voice enrollment readiness returned no id.",
            )
        except httpx.TimeoutException:
            return _timeout("voice")
        except httpx.HTTPStatusError as error:
            return _http_status_error(error, service="voice")
        except (httpx.RequestError, ValueError, KeyError, TypeError):
            return _invalid("voice")
        return CapabilityReady(
            safe_detail="The remote voice service enrolled the readiness sample.",
        )


class RemoteAvatarEnrollAdapter:
    def __init__(
        self,
        client: RemoteGpuClient,
        *,
        sample_path: Path = AVATAR_SAMPLE_PATH,
    ) -> None:
        self._client = client
        self._sample_path = sample_path

    async def check(
        self,
        request: CapabilityCheckRequest,
    ) -> CapabilityCheckOutcome:
        del request
        if not self._sample_path.is_file():
            return CapabilityActionRequired(
                code="avatar_sample_missing",
                message="The bundled avatar sample is missing.",
                recommended_action="Reinstall the application and try again.",
                safe_detail="Avatar enrollment readiness cannot find its sample.",
            )
        try:
            await self._client.enroll_avatar(
                image=self._sample_path.read_bytes(),
            )
        except EmptyEnrollmentError:
            return CapabilityActionRequired(
                code="empty_provider_response",
                message="The remote avatar service returned no enrollment id.",
                recommended_action="Start the remote avatar service and try again.",
                safe_detail="Avatar enrollment readiness returned no id.",
            )
        except httpx.TimeoutException:
            return _timeout("avatar")
        except httpx.HTTPStatusError as error:
            return _http_status_error(error, service="avatar")
        except (httpx.RequestError, ValueError, KeyError, TypeError):
            return _invalid("avatar")
        return CapabilityReady(
            safe_detail="The remote avatar service enrolled the readiness sample.",
        )


class RemoteAvatarStreamAdapter:
    def __init__(
        self,
        client: RemoteGpuClient,
        *,
        voice_sample_path: Path = VOICE_SAMPLE_PATH,
        avatar_sample_path: Path = AVATAR_SAMPLE_PATH,
    ) -> None:
        self._client = client
        self._voice_sample_path = voice_sample_path
        self._avatar_sample_path = avatar_sample_path

    async def check(
        self,
        request: CapabilityCheckRequest,
    ) -> CapabilityCheckOutcome:
        del request
        if (
            not self._voice_sample_path.is_file()
            or not self._avatar_sample_path.is_file()
        ):
            return CapabilityActionRequired(
                code="stream_sample_missing",
                message="A bundled voice or avatar sample is missing.",
                recommended_action="Reinstall the application and try again.",
                safe_detail="Avatar stream readiness cannot find its samples.",
            )
        try:
            voice_id = await self._client.enroll_voice(
                audio=self._voice_sample_path.read_bytes(),
            )
            avatar_id = await self._client.enroll_avatar(
                image=self._avatar_sample_path.read_bytes(),
            )
            stream = await self._client.start_avatar_stream(
                avatar_id=avatar_id,
                voice_id=voice_id,
            )
        except EmptyEnrollmentError:
            return CapabilityActionRequired(
                code="empty_provider_response",
                message="The remote avatar service returned no enrollment id.",
                recommended_action="Start the remote avatar service and try again.",
                safe_detail="Avatar stream readiness could not enroll its samples.",
            )
        except EmptyStreamError:
            return CapabilityActionRequired(
                code="empty_provider_response",
                message="The remote avatar service returned no stream session.",
                recommended_action="Start the remote avatar service and try again.",
                safe_detail="Avatar stream readiness returned no session id.",
            )
        except httpx.TimeoutException:
            return _timeout("avatar stream")
        except httpx.HTTPStatusError as error:
            return _http_status_error(error, service="avatar stream")
        except (httpx.RequestError, ValueError, KeyError, TypeError):
            return _invalid("avatar stream")
        finally:
            if "stream" in locals():
                try:
                    await self._client.stop_avatar_stream(
                        session_id=stream.session_id,
                    )
                except Exception:
                    pass
        return CapabilityReady(
            safe_detail="The remote avatar service started a readiness stream.",
        )


class RemoteTtsAdapter:
    def __init__(self, client: RemoteGpuClient) -> None:
        self._client = client

    async def check(
        self,
        request: CapabilityCheckRequest,
    ) -> CapabilityCheckOutcome:
        del request
        try:
            audio = await self._client.synthesize(text=READINESS_PROMPT)
        except EmptyTtsError:
            return CapabilityActionRequired(
                code="empty_provider_response",
                message="The remote TTS service returned no audio.",
                recommended_action="Start the remote TTS service and try again.",
                safe_detail="TTS readiness returned no audio.",
            )
        except httpx.TimeoutException:
            return _timeout("TTS")
        except httpx.HTTPStatusError as error:
            return _http_status_error(error, service="TTS")
        except (httpx.RequestError, ValueError, KeyError, TypeError):
            return _invalid("TTS")
        if not audio:
            return CapabilityActionRequired(
                code="empty_provider_response",
                message="The remote TTS service returned empty audio.",
                recommended_action="Start the remote TTS service and try again.",
                safe_detail="TTS readiness audio was empty.",
            )
        return CapabilityReady(
            safe_detail="The remote TTS service synthesized a readiness sample.",
        )
