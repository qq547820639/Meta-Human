import json
from collections.abc import AsyncIterator
from dataclasses import dataclass

import httpx

from voxstudio_core.capabilities.base import (
    ResponseValidationError,
    is_html_content_type,
    validate_json_response,
)
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
class StructuredReply:
    answer: str
    used_source_ids: tuple[str, ...]
    confidence: float
    insufficient_context: bool
    suggested_follow_up: str | None = None


@dataclass(frozen=True, slots=True)
class StructuredChatCompletion:
    text: str
    structured: StructuredReply | None


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
        text = await self._post_chat(model=model, prompt=prompt, max_tokens=32)
        return ChatCompletion(text=text)

    async def chat_completion_structured(
        self,
        *,
        model: str,
        prompt: str,
    ) -> StructuredChatCompletion:
        json_prompt = (
            prompt
            + "\n\nRespond with ONLY a single JSON object (no markdown, no code "
            "fences) whose keys are exactly: \"answer\" (string), "
            "\"used_source_ids\" (array of strings), \"confidence\" (number 0-1), "
            "\"insufficient_context\" (boolean), "
            "\"suggested_follow_up\" (string or null)."
        )
        text = await self._post_chat(model=model, prompt=json_prompt, max_tokens=512)
        return StructuredChatCompletion(
            text=text,
            structured=parse_structured_reply(text),
        )

    async def chat_completion_stream(
        self,
        *,
        model: str,
        prompt: str,
    ) -> AsyncIterator[str]:
        payload = {
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": 512,
            "stream": True,
        }
        async with self._client() as client:
            async with client.stream(
                "POST",
                f"{self._config.base_url}/v1/chat/completions",
                json=payload,
            ) as response:
                response.raise_for_status()
                if is_html_content_type(
                    response.headers.get("content-type", "")
                ):
                    validation = validate_json_response(
                        response,
                        service="本地模型",
                        required_fields=(),
                    )
                    raise ResponseValidationError(validation)
                async for line in response.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    data = line[len("data:") :].strip()
                    if data == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data)
                    except (TypeError, ValueError):
                        continue
                    choices = chunk.get("choices") or []
                    if not choices:
                        continue
                    delta = choices[0].get("delta") or {}
                    text = delta.get("content")
                    if text:
                        yield text

    async def _post_chat(
        self,
        *,
        model: str,
        prompt: str,
        max_tokens: int,
    ) -> str:
        payload = {
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": max_tokens,
            "stream": False,
        }
        async with self._client() as client:
            response = await client.post(
                f"{self._config.base_url}/v1/chat/completions",
                json=payload,
            )
            response.raise_for_status()
            validation = validate_json_response(
                response,
                service="本地模型",
                required_fields=("choices",),
            )
            if not validation.ok:
                raise ResponseValidationError(validation)
            data = response.json()
            text = data["choices"][0]["message"]["content"]
            if not isinstance(text, str):
                raise ValueError("chat completion returned empty content")
            if not text.strip():
                raise EmptyProviderContentError(
                    "chat completion returned empty content"
                )
            return text.strip()

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


def parse_structured_reply(text: str) -> StructuredReply | None:
    try:
        data = json.loads(text)
    except (TypeError, ValueError):
        return None
    if not isinstance(data, dict):
        return None
    answer = data.get("answer")
    if not isinstance(answer, str) or not answer.strip():
        return None
    used = data.get("used_source_ids")
    if used is None:
        used = []
    if not isinstance(used, list):
        return None
    used_ids = tuple(
        str(item) for item in used if isinstance(item, str) and item
    )
    confidence = data.get("confidence")
    if confidence is None:
        confidence = 1.0
    if not isinstance(confidence, (int, float)) or isinstance(confidence, bool):
        confidence = 0.0
    insufficient = data.get("insufficient_context")
    if not isinstance(insufficient, bool):
        insufficient = False
    follow_up = data.get("suggested_follow_up")
    if follow_up is not None and not isinstance(follow_up, str):
        follow_up = None
    return StructuredReply(
        answer=answer.strip(),
        used_source_ids=used_ids,
        confidence=float(confidence),
        insufficient_context=insufficient,
        suggested_follow_up=follow_up,
    )
