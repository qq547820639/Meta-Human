from dataclasses import dataclass

import httpx

from voxstudio_core.providers.local_config import LocalProviderConfig


class EmptyProviderContentError(ValueError):
    pass


class EmptyEmbeddingError(ValueError):
    pass


class EmptyTranscriptionError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class ChatCompletion:
    text: str


@dataclass(frozen=True, slots=True)
class Embedding:
    vector: tuple[float, ...]


class OpenAICompatibleClient:
    def __init__(
        self,
        config: LocalProviderConfig,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._config = config
        self._transport = transport

    async def chat_completion(self, *, model: str, prompt: str) -> ChatCompletion:
        payload = {
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": 32,
            "stream": False,
        }
        async with self._client() as client:
            response = await client.post(
                f"{self._config.base_url}/v1/chat/completions",
                json=payload,
            )
            response.raise_for_status()
            data = response.json()
            text = data["choices"][0]["message"]["content"]
            if not isinstance(text, str):
                raise ValueError("chat completion returned empty content")
            if not text.strip():
                raise EmptyProviderContentError("chat completion returned empty content")
            return ChatCompletion(text=text.strip())

    async def embedding(self, *, model: str, input: str) -> Embedding:
        payload = {"model": model, "input": input}
        async with self._client() as client:
            response = await client.post(
                f"{self._config.base_url}/v1/embeddings",
                json=payload,
            )
            response.raise_for_status()
            data = response.json()
            raw = data["data"][0]["embedding"]
            if not isinstance(raw, list) or not raw:
                raise EmptyEmbeddingError("embedding response is empty")
            vector = tuple(float(value) for value in raw)
            if any(value != value for value in vector):
                raise ValueError("embedding contains non-finite values")
            return Embedding(vector=vector)

    async def transcribe(
        self,
        *,
        model: str,
        audio: bytes,
        filename: str = "readiness.wav",
    ) -> str:
        async with self._client() as client:
            response = await client.post(
                f"{self._config.base_url}/v1/audio/transcriptions",
                data={"model": model},
                files={"file": (filename, audio, "audio/wav")},
            )
            response.raise_for_status()
            data = response.json()
            text = data.get("text")
            if not isinstance(text, str) or not text.strip():
                raise EmptyTranscriptionError(
                    "transcription returned empty content"
                )
            return text.strip()

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            timeout=httpx.Timeout(self._config.timeout_seconds),
            transport=self._transport,
        )
