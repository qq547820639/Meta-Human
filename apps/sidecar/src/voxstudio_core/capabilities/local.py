from pathlib import Path

import httpx

from voxstudio_core.capabilities.base import (
    CapabilityActionRequired,
    CapabilityCheckOutcome,
    CapabilityCheckRequest,
    CapabilityReady,
    CapabilityTransientFailure,
    ResponseValidationError,
    validation_failure_outcome,
)
from voxstudio_core.providers.openai_compatible import (
    EmptyEmbeddingError,
    EmptyProviderContentError,
    EmptyTranscriptionError,
    OpenAICompatibleClient,
)

READINESS_PROMPT = "Reply with the single word: ready"


def _validation(
    error: ResponseValidationError,
    *,
    capability_label: str,
    safe_detail: str,
) -> CapabilityCheckOutcome:
    """Map a structural validation failure to a capability outcome."""
    validation = error.validation
    if validation.code in {
        "html_response",
        "empty_response",
        "provider_error",
        "missing_field",
    }:
        return validation_failure_outcome(
            validation,
            capability_label=capability_label,
            safe_detail=safe_detail,
        )
    return CapabilityTransientFailure(
        code="invalid_provider_response",
        message="The local service returned an invalid response.",
        safe_detail=safe_detail,
    )


def _unavailable() -> CapabilityTransientFailure:
    return CapabilityTransientFailure(
        code="provider_unavailable",
        message="The local model service is unavailable.",
        safe_detail="The chat readiness check could not be completed.",
    )


def _not_found(service_label: str) -> CapabilityActionRequired:
    return CapabilityActionRequired(
        code="provider_not_found",
        message=f"{service_label}接口不存在（404），请检查服务地址是否正确。",
        recommended_action="请检查本地服务地址与接口路径后重试。",
        safe_detail="The local service readiness endpoint was not found.",
    )


def _rate_limited(service_label: str) -> CapabilityTransientFailure:
    return CapabilityTransientFailure(
        code="provider_rate_limited",
        message=f"{service_label}服务请求过于频繁（429），请稍后重试。",
        safe_detail="The local service readiness check was rate limited.",
    )


def _unreachable() -> CapabilityActionRequired:
    return CapabilityActionRequired(
        code="provider_unreachable",
        message="无法连接到本地模型服务，请确认服务已启动且地址正确。",
        recommended_action="请启动本地模型服务并检查地址后重试。",
        safe_detail="The local service could not be reached.",
    )


def _http_status_error(
    error: httpx.HTTPStatusError,
    *,
    service_label: str,
) -> CapabilityCheckOutcome:
    status = error.response.status_code
    if status in {401, 403}:
        return CapabilityActionRequired(
            code="provider_access_required",
            message=f"The local {service_label} service rejected access.",
            recommended_action=(
                "Check local model service access settings and try again."
            ),
            safe_detail=f"The {service_label} readiness check was rejected.",
        )
    if status == 404:
        return _not_found(service_label)
    if status == 429:
        return _rate_limited(service_label)
    return _unavailable()


STT_SAMPLE_PATH = (
    Path(__file__).resolve().parent.parent
    / "assets"
    / "readiness"
    / "stt_sample.wav"
)


class LocalChatAdapter:
    def __init__(
        self,
        client: OpenAICompatibleClient,
        model: str,
        *,
        prompt: str = READINESS_PROMPT,
    ) -> None:
        self._client = client
        self._model = model
        self._prompt = prompt

    async def check(
        self,
        request: CapabilityCheckRequest,
    ) -> CapabilityCheckOutcome:
        del request
        try:
            await self._client.chat_completion(
                model=self._model,
                prompt=self._prompt,
            )
        except ResponseValidationError as error:
            return _validation(
                error,
                capability_label="本地模型",
                safe_detail="The chat readiness response failed validation.",
            )
        except EmptyProviderContentError:
            return CapabilityActionRequired(
                code="empty_provider_response",
                message="The local model service returned an empty reply.",
                recommended_action="Start the local model service and try again.",
                safe_detail="The chat readiness reply was empty.",
            )
        except httpx.TimeoutException:
            return CapabilityTransientFailure(
                code="provider_timeout",
                message="The local model service did not answer in time.",
                safe_detail="The chat readiness check timed out.",
            )
        except httpx.ConnectError:
            return _unreachable()
        except httpx.HTTPStatusError as error:
            return _http_status_error(error, service_label="chat")
        except (httpx.RequestError, KeyError, TypeError, IndexError, ValueError):
            return CapabilityTransientFailure(
                code="invalid_provider_response",
                message="The local model service returned an invalid response.",
                safe_detail="The chat readiness response was invalid.",
            )

        return CapabilityReady(
            safe_detail="The local chat model answered a readiness prompt.",
        )


class LocalEmbeddingAdapter:
    def __init__(
        self,
        client: OpenAICompatibleClient,
        model: str,
        *,
        prompt: str = READINESS_PROMPT,
    ) -> None:
        self._client = client
        self._model = model
        self._prompt = prompt

    async def check(
        self,
        request: CapabilityCheckRequest,
    ) -> CapabilityCheckOutcome:
        del request
        try:
            await self._client.embedding(
                model=self._model,
                input=self._prompt,
            )
        except EmptyEmbeddingError:
            return CapabilityActionRequired(
                code="empty_provider_response",
                message="The local embedding service returned an empty vector.",
                recommended_action="Start the local embedding service and try again.",
                safe_detail="The embedding readiness vector was empty.",
            )
        except httpx.TimeoutException:
            return CapabilityTransientFailure(
                code="provider_timeout",
                message="The local embedding service did not answer in time.",
                safe_detail="The embedding readiness check timed out.",
            )
        except httpx.HTTPStatusError as error:
            return _http_status_error(error, service_label="embedding")
        except (httpx.RequestError, KeyError, TypeError, IndexError, ValueError):
            return CapabilityTransientFailure(
                code="invalid_provider_response",
                message="The local embedding service returned an invalid response.",
                safe_detail="The embedding readiness response was invalid.",
            )

        return CapabilityReady(
            safe_detail="The local embedding model returned a finite vector.",
        )


class LocalSttAdapter:
    def __init__(
        self,
        client: OpenAICompatibleClient,
        model: str | None,
        *,
        sample_path: Path = STT_SAMPLE_PATH,
    ) -> None:
        self._client = client
        self._model = model
        self._sample_path = sample_path

    async def check(
        self,
        request: CapabilityCheckRequest,
    ) -> CapabilityCheckOutcome:
        del request
        if not self._model:
            return CapabilityActionRequired(
                code="stt_provider_not_configured",
                message="A local STT model is not configured.",
                recommended_action="Set the local STT model and try again.",
                safe_detail="Speech recognition readiness needs an STT model.",
            )
        if not self._sample_path.is_file():
            return CapabilityActionRequired(
                code="stt_sample_missing",
                message="The bundled speech sample is missing.",
                recommended_action="Reinstall the application and try again.",
                safe_detail="Speech recognition readiness cannot find its sample.",
            )

        try:
            await self._client.transcribe(
                model=self._model,
                audio=self._sample_path.read_bytes(),
            )
        except EmptyTranscriptionError:
            return CapabilityActionRequired(
                code="empty_stt_response",
                message="The local STT service returned an empty transcription.",
                recommended_action="Start the local STT model and try again.",
                safe_detail="Speech recognition readiness returned no text.",
            )
        except httpx.TimeoutException:
            return CapabilityTransientFailure(
                code="provider_timeout",
                message="The local STT service did not answer in time.",
                safe_detail="Speech recognition readiness timed out.",
            )
        except httpx.HTTPStatusError as error:
            return _http_status_error(error, service_label="STT")
        except (httpx.RequestError, ValueError, KeyError, TypeError):
            return CapabilityTransientFailure(
                code="invalid_provider_response",
                message="The local STT service returned an invalid response.",
                safe_detail="Speech recognition readiness response was invalid.",
            )
        return CapabilityReady(
            safe_detail="The local STT model transcribed the readiness sample.",
        )
