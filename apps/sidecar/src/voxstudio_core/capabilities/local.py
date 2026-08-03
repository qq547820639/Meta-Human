from pathlib import Path

import httpx

from voxstudio_core.capabilities.base import (
    CapabilityActionRequired,
    CapabilityCheckOutcome,
    CapabilityCheckRequest,
    CapabilityReady,
    CapabilityTransientFailure,
)
from voxstudio_core.providers.openai_compatible import (
    EmptyEmbeddingError,
    EmptyProviderContentError,
    EmptyTranscriptionError,
    OpenAICompatibleClient,
)

READINESS_PROMPT = "Reply with the single word: ready"
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
            result = await self._client.chat_completion(
                model=self._model,
                prompt=self._prompt,
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
        except httpx.HTTPStatusError as error:
            if error.response.status_code in {401, 403}:
                return CapabilityActionRequired(
                    code="provider_access_required",
                    message="The local model service rejected access.",
                    recommended_action="Check local model service access settings and try again.",
                    safe_detail="The chat readiness check was rejected.",
                )
            return CapabilityTransientFailure(
                code="provider_unavailable",
                message="The local model service is unavailable.",
                safe_detail="The chat readiness check could not be completed.",
            )
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
            result = await self._client.embedding(
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
            if error.response.status_code in {401, 403}:
                return CapabilityActionRequired(
                    code="provider_access_required",
                    message="The local embedding service rejected access.",
                    recommended_action="Check local embedding service access settings and try again.",
                    safe_detail="The embedding readiness check was rejected.",
                )
            return CapabilityTransientFailure(
                code="provider_unavailable",
                message="The local embedding service is unavailable.",
                safe_detail="The embedding readiness check could not be completed.",
            )
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
            if error.response.status_code in {401, 403}:
                return CapabilityActionRequired(
                    code="provider_access_required",
                    message="The local STT service rejected access.",
                    recommended_action="Check local STT service access settings and try again.",
                    safe_detail="Speech recognition readiness was rejected.",
                )
            return CapabilityTransientFailure(
                code="provider_unavailable",
                message="The local STT service is unavailable.",
                safe_detail="Speech recognition readiness could not be completed.",
            )
        except (httpx.RequestError, ValueError, KeyError, TypeError):
            return CapabilityTransientFailure(
                code="invalid_provider_response",
                message="The local STT service returned an invalid response.",
                safe_detail="Speech recognition readiness response was invalid.",
            )
        return CapabilityReady(
            safe_detail="The local STT model transcribed the readiness sample.",
        )
