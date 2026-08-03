from contextlib import asynccontextmanager
from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient

from voxstudio_core.api.app import create_app
from voxstudio_core.config import SidecarConfig, generate_startup_token
from voxstudio_core.knowledge.conversation import ConversationReply
from voxstudio_core.knowledge.memory import ConversationMemory
from voxstudio_core.persistence.conversation_repository import (
    Conversation,
    ConversationNotFoundError,
)


class StubConversationService:
    def __init__(self, audio_base64: str | None = None) -> None:
        self.audio_base64 = audio_base64
        self.last_regenerate = False
        self.conversations: dict[str, Conversation] = {}

    async def reply(
        self,
        *,
        query: str,
        regenerate: bool = False,
        conversation_id: str | None = None,
    ) -> ConversationReply:
        self.last_regenerate = regenerate
        self.last_conversation_id = conversation_id
        return ConversationReply(
            text=f"回答：{query}",
            citations=("[Wearable Guide]",),
            grounded=True,
            audio_base64=self.audio_base64,
        )

    async def create_conversation(
        self,
        *,
        title: str | None = None,
        avatar_id: str | None = None,
    ) -> Conversation:
        conversation = Conversation(
            id=f"conv-{len(self.conversations) + 1}",
            title=title or "新对话",
            avatar_id=avatar_id,
            created_at="2026-01-01T00:00:00Z",
            updated_at="2026-01-01T00:00:00Z",
            last_message_at=None,
            archived=False,
            deleted=False,
            summary=None,
        )
        self.conversations[conversation.id] = conversation
        return conversation

    async def list_conversations(self, **kwargs) -> tuple[Conversation, ...]:
        return tuple(self.conversations.values())

    async def count_conversations(self, **kwargs) -> int:
        return len(self.conversations)

    async def search_conversations(self, **kwargs) -> tuple[Conversation, ...]:
        return tuple(self.conversations.values())

    async def get_conversation(self, conversation_id: str) -> Conversation:
        self.last_get_conversation_id = conversation_id
        return self._require(conversation_id)

    async def rename_conversation(
        self,
        conversation_id: str,
        *,
        title: str,
    ) -> Conversation:
        conversation = self._require(conversation_id)
        renamed = Conversation(
            id=conversation.id,
            title=title,
            avatar_id=conversation.avatar_id,
            created_at=conversation.created_at,
            updated_at=conversation.updated_at,
            last_message_at=conversation.last_message_at,
            archived=conversation.archived,
            deleted=conversation.deleted,
            summary=conversation.summary,
        )
        self.conversations[conversation_id] = renamed
        return renamed

    async def delete_conversation(self, conversation_id: str) -> None:
        self._require(conversation_id)
        del self.conversations[conversation_id]

    async def archive_conversation(
        self,
        conversation_id: str,
        *,
        archived: bool = True,
    ) -> Conversation:
        conversation = self._require(conversation_id)
        updated = Conversation(
            id=conversation.id,
            title=conversation.title,
            avatar_id=conversation.avatar_id,
            created_at=conversation.created_at,
            updated_at=conversation.updated_at,
            last_message_at=conversation.last_message_at,
            archived=archived,
            deleted=conversation.deleted,
            summary=conversation.summary,
        )
        self.conversations[conversation_id] = updated
        return updated

    async def clear_conversation(self, conversation_id: str) -> None:
        self.last_cleared_conversation_id = conversation_id
        self._require(conversation_id)

    async def export_conversation(self, conversation_id: str) -> dict:
        conversation = self._require(conversation_id)
        return {"conversation": conversation, "messages": ()}

    def _require(self, conversation_id: str) -> Conversation:
        try:
            return self.conversations[conversation_id]
        except KeyError:
            raise ConversationNotFoundError(conversation_id) from None

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
        "used_source_ids": [],
        "confidence": None,
        "insufficient_context": False,
        "suggested_follow_up": None,
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


# --- TASK 7: conversation management API -------------------------------------


@pytest.mark.asyncio
async def test_conversation_create_list_and_get() -> None:
    token = generate_startup_token()
    service = StubConversationService()
    async with running_client(token, service) as client:
        created = await client.post(
            "/v1/conversations",
            headers=authorization(token),
            json={"title": "我的会话", "avatar_id": "avatar-1"},
        )
        listed = await client.get(
            "/v1/conversations",
            headers=authorization(token),
        )
        fetched = await client.get(
            f"/v1/conversations/{created.json()['id']}",
            headers=authorization(token),
        )

    assert created.status_code == 200
    assert created.json()["title"] == "我的会话"
    assert created.json()["avatar_id"] == "avatar-1"
    assert listed.status_code == 200
    assert listed.json()["total"] == 1
    assert fetched.status_code == 200
    assert fetched.json()["id"] == created.json()["id"]


@pytest.mark.asyncio
async def test_conversation_rename_and_delete() -> None:
    token = generate_startup_token()
    service = StubConversationService()
    async with running_client(token, service) as client:
        created = await client.post(
            "/v1/conversations",
            headers=authorization(token),
            json={},
        )
        conversation_id = created.json()["id"]
        renamed = await client.patch(
            f"/v1/conversations/{conversation_id}",
            headers=authorization(token),
            json={"title": "改名后"},
        )
        deleted = await client.delete(
            f"/v1/conversations/{conversation_id}",
            headers=authorization(token),
        )

    assert renamed.status_code == 200
    assert renamed.json()["title"] == "改名后"
    assert deleted.status_code == 200
    assert deleted.json() == {"cleared": True}


@pytest.mark.asyncio
async def test_conversation_archive_and_clear() -> None:
    token = generate_startup_token()
    service = StubConversationService()
    async with running_client(token, service) as client:
        created = await client.post(
            "/v1/conversations",
            headers=authorization(token),
            json={},
        )
        conversation_id = created.json()["id"]
        archived = await client.post(
            f"/v1/conversations/{conversation_id}/archive",
            headers=authorization(token),
            json={"archived": True},
        )
        cleared = await client.post(
            f"/v1/conversations/{conversation_id}/clear",
            headers=authorization(token),
        )

    assert archived.status_code == 200
    assert archived.json()["archived"] is True
    assert cleared.status_code == 200
    assert service.last_cleared_conversation_id == conversation_id


@pytest.mark.asyncio
async def test_conversation_search_and_export() -> None:
    token = generate_startup_token()
    service = StubConversationService()
    async with running_client(token, service) as client:
        created = await client.post(
            "/v1/conversations",
            headers=authorization(token),
            json={"title": "飞行器指南"},
        )
        conversation_id = created.json()["id"]
        searched = await client.get(
            "/v1/conversations/search",
            headers=authorization(token),
            params={"q": "飞行器"},
        )
        exported = await client.get(
            f"/v1/conversations/{conversation_id}/export",
            headers=authorization(token),
        )

    assert searched.status_code == 200
    assert searched.json()["total"] == 1
    assert exported.status_code == 200
    assert exported.json()["conversation"]["title"] == "飞行器指南"
    assert exported.json()["messages"] == []


@pytest.mark.asyncio
async def test_conversation_get_missing_returns_404() -> None:
    token = generate_startup_token()
    async with running_client(token, StubConversationService()) as client:
        response = await client.get(
            "/v1/conversations/missing",
            headers=authorization(token),
        )

    assert response.status_code == 404
