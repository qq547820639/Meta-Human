from collections.abc import AsyncIterator
from pathlib import Path

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI, HTTPException

from voxstudio_core.capabilities.base import CapabilityReady
from voxstudio_core.capabilities.fake import FakeCapabilityAdapter
from voxstudio_core.capabilities.local import (
    LocalChatAdapter,
    LocalEmbeddingAdapter,
    LocalSttAdapter,
)
from voxstudio_core.capabilities.registry import CapabilityAdapterRegistry
from voxstudio_core.persistence.database import Database
from voxstudio_core.persistence.readiness_repository import ReadinessRepository
from voxstudio_core.providers.local_config import LocalProviderConfig
from voxstudio_core.providers.openai_compatible import OpenAICompatibleClient
from voxstudio_core.readiness.models import (
    AggregateState,
    CapabilityId,
    CapabilityState,
    gate_open,
)
from voxstudio_core.readiness.service import ReadinessService


@pytest_asyncio.fixture
async def repository(tmp_path: Path) -> AsyncIterator[ReadinessRepository]:
    database = Database(tmp_path / "provider-readiness.sqlite3")
    await database.connect()
    await database.migrate()
    try:
        yield ReadinessRepository(database)
    finally:
        await database.close()


def registry_with_local_providers(
    app: FastAPI,
    *,
    chat_unavailable: bool = False,
    stt_model: str | None = "local-stt",
) -> CapabilityAdapterRegistry:
    config = LocalProviderConfig(
        base_url="http://127.0.0.1:11434",
        chat_model="local-chat",
        embedding_model="local-embed",
    )
    client = OpenAICompatibleClient(
        config,
        transport=httpx.ASGITransport(app=app),
    )
    adapters = {
        capability_id: FakeCapabilityAdapter(
            [CapabilityReady(safe_detail="Capability check passed.")]
        )
        for capability_id in CapabilityId
    }
    adapters[CapabilityId.LLM_CHAT] = LocalChatAdapter(
        client,
        config.chat_model,
    )
    adapters[CapabilityId.EMBEDDING_TEXT] = LocalEmbeddingAdapter(
        client,
        config.embedding_model,
    )
    adapters[CapabilityId.STT_TRANSCRIBE] = LocalSttAdapter(
        client,
        stt_model,
    )
    return CapabilityAdapterRegistry(adapters)


def stub_provider(*, chat_status: int = 200) -> FastAPI:
    app = FastAPI()

    @app.post("/v1/chat/completions")
    async def chat_completions() -> object:
        if chat_status != 200:
            raise HTTPException(status_code=chat_status, detail="unavailable")
        return {"choices": [{"message": {"role": "assistant", "content": "ready"}}]}

    @app.post("/v1/embeddings")
    async def embeddings() -> object:
        return {"data": [{"embedding": [0.1, 0.2, 0.3]}]}

    @app.post("/v1/audio/transcriptions")
    async def transcriptions() -> object:
        return {"text": "ready"}

    return app


@pytest.mark.asyncio
async def test_local_chat_and_embedding_adapters_open_the_gate(
    repository: ReadinessRepository,
) -> None:
    service = ReadinessService(
        repository=repository,
        registry=registry_with_local_providers(stub_provider()),
    )

    result = await service.prepare()

    assert result.state is AggregateState.READY
    assert gate_open(result.capabilities) is True
    assert all(
        capability.state is CapabilityState.READY
        for capability in result.capabilities
    )


@pytest.mark.asyncio
async def test_chat_provider_failure_fails_closed_with_retryable_error(
    repository: ReadinessRepository,
) -> None:
    service = ReadinessService(
        repository=repository,
        registry=registry_with_local_providers(
            stub_provider(chat_status=503),
        ),
    )

    result = await service.prepare()

    assert result.state is AggregateState.DEGRADED
    assert gate_open(result.capabilities) is False
    chat = next(
        capability
        for capability in result.capabilities
        if capability.id is CapabilityId.LLM_CHAT
    )
    assert chat.state is CapabilityState.DEGRADED
    assert chat.error is not None
    assert chat.error.code == "provider_unavailable"
    assert chat.error.retryable is True


@pytest.mark.asyncio
async def test_missing_stt_model_keeps_gate_action_required(
    repository: ReadinessRepository,
) -> None:
    service = ReadinessService(
        repository=repository,
        registry=registry_with_local_providers(
            stub_provider(),
            stt_model=None,
        ),
    )

    result = await service.prepare()

    assert result.state is AggregateState.ACTION_REQUIRED
    assert gate_open(result.capabilities) is False
    stt = next(
        capability
        for capability in result.capabilities
        if capability.id is CapabilityId.STT_TRANSCRIBE
    )
    assert stt.state is CapabilityState.ACTION_REQUIRED
    assert stt.error is not None
    assert stt.error.code == "stt_provider_not_configured"
