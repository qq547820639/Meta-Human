from contextlib import asynccontextmanager
from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient

from voxstudio_core.api.app import create_app
from voxstudio_core.config import SidecarConfig, generate_startup_token
from voxstudio_core.knowledge.conversation import ConversationReply
from voxstudio_core.knowledge.memory import ConversationMemory


class StubConversationService:
    def __init__(self, audio_base64: str | None = None) -> None:
        self.audio_base64 = audio_base64
        self.last_regenerate = False

    async def reply(
        self,
        *,
        query: str,
        regenerate: bool = False,
    ) -> ConversationReply:
        self.last_regenerate = regenerate
        return ConversationReply(
            text=f"回答：{query}",
            citations=("[Wearable Guide]",),
            grounded=True,
            audio_base64=self.audio_base64,
        )

    async def recent_history(self):
        return ()

    async def clear_history(self) -> None:
        return None

    async def transcribe(self, *, audio_path: str) -> str:
        self.last_audio_path = audio_path
        return "语音内容"

    async def current_memory(self):
        return ConversationMemory(summary="记忆摘要")

    async def update_memory(self, *, summary: str) -> None:
        self.updated_summary = summary

    async def clear_memory(self) -> None:
        self.memory_cleared = True


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
    conversation_service: StubConversationService | None = None,
) -> AsyncIterator[AsyncClient]:
    app = create_app(
        config=SidecarConfig(bearer_token=token),
        lifecycle=EmptyLifecycle(),
        conversation_service=conversation_service or StubConversationService(),
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
async def test_conversation_reply_returns_grounded_citations() -> None:
    token = generate_startup_token()
    async with running_client(token) as client:
        response = await client.post(
            "/v1/conversation/replies",
            headers=authorization(token),
            json={"query": "How does entry work?"},
        )

    assert response.status_code == 200
    assert response.json() == {
        "text": "回答：How does entry work?",
        "citations": ["[Wearable Guide]"],
        "grounded": True,
        "audio_base64": None,
        "citation_urls": [],
    }


@pytest.mark.asyncio
async def test_conversation_reply_returns_tts_audio_when_available() -> None:
    token = generate_startup_token()
    async with running_client(token, StubConversationService("QUJD")) as client:
        response = await client.post(
            "/v1/conversation/replies",
            headers=authorization(token),
            json={"query": "Speak to me"},
        )

    assert response.status_code == 200
    assert response.json()["audio_base64"] == "QUJD"


@pytest.mark.asyncio
async def test_conversation_history_can_be_read_and_cleared() -> None:
    token = generate_startup_token()
    async with running_client(token) as client:
        history_response = await client.get(
            "/v1/conversation/history",
            headers=authorization(token),
        )
        clear_response = await client.delete(
            "/v1/conversation/history",
            headers=authorization(token),
        )

    assert history_response.status_code == 200
    assert history_response.json() == {"messages": []}
    assert clear_response.status_code == 200
    assert clear_response.json() == {"cleared": True}


@pytest.mark.asyncio
async def test_conversation_reply_requires_bearer_token() -> None:
    token = generate_startup_token()
    async with running_client(token) as client:
        response = await client.post(
            "/v1/conversation/replies",
            json={"query": "Hello"},
        )

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_conversation_reply_passes_regenerate_flag() -> None:
    token = generate_startup_token()
    service = StubConversationService()
    async with running_client(token, service) as client:
        response = await client.post(
            "/v1/conversation/replies",
            headers=authorization(token),
            json={"query": "Again", "regenerate": True},
        )

    assert response.status_code == 200
    assert service.last_regenerate is True


@pytest.mark.asyncio
async def test_conversation_reply_rejects_empty_query() -> None:
    token = generate_startup_token()
    async with running_client(token) as client:
        response = await client.post(
            "/v1/conversation/replies",
            headers=authorization(token),
            json={"query": ""},
        )

    assert response.status_code == 422


@pytest.mark.asyncio
async def test_conversation_transcribe_returns_text() -> None:
    token = generate_startup_token()
    service = StubConversationService()
    async with running_client(token, service) as client:
        response = await client.post(
            "/v1/conversation/transcribe",
            headers=authorization(token),
            json={"audio_path": "/tmp/voice.wav"},
        )

    assert response.status_code == 200
    assert response.json() == {"text": "语音内容"}
    assert service.last_audio_path == "/tmp/voice.wav"


@pytest.mark.asyncio
async def test_conversation_transcribe_requires_bearer_token() -> None:
    token = generate_startup_token()
    async with running_client(token, StubConversationService()) as client:
        response = await client.post(
            "/v1/conversation/transcribe",
            json={"audio_path": "/tmp/voice.wav"},
        )

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_conversation_memory_can_be_read_updated_and_cleared() -> None:
    token = generate_startup_token()
    service = StubConversationService()
    async with running_client(token, service) as client:
        read = await client.get(
            "/v1/conversation/memory",
            headers=authorization(token),
        )
        update = await client.put(
            "/v1/conversation/memory",
            headers=authorization(token),
            json={"summary": "新摘要"},
        )
        clear = await client.delete(
            "/v1/conversation/memory",
            headers=authorization(token),
        )

    assert read.status_code == 200
    assert read.json()["summary"] == "记忆摘要"
    assert update.status_code == 200
    assert service.updated_summary == "新摘要"
    assert clear.status_code == 200
    assert clear.json() == {"cleared": True}
