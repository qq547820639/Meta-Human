from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from types import SimpleNamespace

import httpx
import pytest
from httpx import ASGITransport, AsyncClient

from voxstudio_core.api.app import create_app
from voxstudio_core.config import SidecarConfig, generate_startup_token
from voxstudio_core.knowledge.conversation import (
    ConversationReply,
    ConversationService,
)
from voxstudio_core.knowledge.history import ConversationHistoryStore
from voxstudio_core.knowledge.memory import ConversationMemory
from voxstudio_core.knowledge.retrieval import KnowledgeRetriever
from voxstudio_core.persistence.conversation_repository import (
    Conversation,
    ConversationNotFoundError,
    ConversationRepository,
)
from voxstudio_core.persistence.database import Database
from voxstudio_core.providers.local_config import LocalProviderConfig
from voxstudio_core.providers.openai_compatible import OpenAICompatibleClient


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

    async def set_temporary_conversation(
        self,
        conversation_id: str,
        *,
        is_temporary: bool,
    ) -> Conversation:
        conversation = self._require(conversation_id)
        updated = Conversation(
            id=conversation.id,
            title=conversation.title,
            avatar_id=conversation.avatar_id,
            created_at=conversation.created_at,
            updated_at=conversation.updated_at,
            last_message_at=conversation.last_message_at,
            archived=conversation.archived,
            deleted=conversation.deleted,
            summary=conversation.summary,
            is_temporary=is_temporary,
        )
        self.conversations[conversation_id] = updated
        return updated

    async def get_source_message(self, message_id: int):
        self.last_source_message_id = message_id
        if message_id == 42:
            return SimpleNamespace(
                role="user",
                content="我喜欢在早上喝咖啡",
                created_at="2026-01-01T00:00:00Z",
            )
        return None

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


@pytest.mark.asyncio
async def test_conversation_temporary_flag_can_be_toggled() -> None:
    token = generate_startup_token()
    service = StubConversationService()
    async with running_client(token, service) as client:
        created = await client.post(
            "/v1/conversations",
            headers=authorization(token),
            json={},
        )
        conversation_id = created.json()["id"]
        assert created.json()["is_temporary"] is False

        temporary = await client.post(
            f"/v1/conversations/{conversation_id}/temporary",
            headers=authorization(token),
            json={"temporary": True},
        )
        restored = await client.post(
            f"/v1/conversations/{conversation_id}/temporary",
            headers=authorization(token),
            json={"temporary": False},
        )

    assert temporary.status_code == 200
    assert temporary.json()["is_temporary"] is True
    assert restored.status_code == 200
    assert restored.json()["is_temporary"] is False


@pytest.mark.asyncio
async def test_conversation_temporary_missing_returns_404() -> None:
    token = generate_startup_token()
    async with running_client(token, StubConversationService()) as client:
        response = await client.post(
            "/v1/conversations/missing/temporary",
            headers=authorization(token),
            json={"temporary": True},
        )

    assert response.status_code == 404


@pytest.mark.asyncio
async def test_source_message_lookup_reports_found_and_missing() -> None:
    token = generate_startup_token()
    service = StubConversationService()
    async with running_client(token, service) as client:
        found = await client.get(
            "/v1/conversation/messages/42",
            headers=authorization(token),
        )
        missing = await client.get(
            "/v1/conversation/messages/999",
            headers=authorization(token),
        )

    assert found.status_code == 200
    assert found.json()["found"] is True
    assert found.json()["content"] == "我喜欢在早上喝咖啡"
    assert found.json()["role"] == "user"
    assert missing.status_code == 200
    assert missing.json()["found"] is False
    assert missing.json()["content"] is None
    # The last lookup id reaches the service (both lookups were served).
    assert service.last_source_message_id == 999


# --- TASK 2: conversation message restore contract ---------------------------


def _reply_transport() -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": "这是回答。"}}]},
        )

    return httpx.MockTransport(handler)


def _real_conversation_service(
    database: Database,
    transport: httpx.MockTransport,
) -> ConversationService:
    config = LocalProviderConfig(
        base_url="http://127.0.0.1:11434",
        chat_model="local-chat",
        embedding_model="local-embed",
    )
    return ConversationService(
        retriever=KnowledgeRetriever(database),
        chat_client=OpenAICompatibleClient(config, transport=transport),
        chat_model="local-chat",
        history=ConversationHistoryStore(database),
        conversations=ConversationRepository(database),
    )


@pytest.mark.asyncio
async def test_conversation_messages_restore_after_restart(tmp_path) -> None:
    token = generate_startup_token()
    database = Database(tmp_path / "conversation.sqlite3")
    await database.connect()
    await database.migrate()
    try:
        service = _real_conversation_service(database, _reply_transport())
        app = create_app(
            config=SidecarConfig(bearer_token=token),
            lifecycle=EmptyLifecycle(),
            conversation_service=service,
        )
        async with app.router.lifespan_context(app):
            async with AsyncClient(
                transport=ASGITransport(app=app),
                base_url="http://sidecar.test",
            ) as client:
                created = await client.post(
                    "/v1/conversations",
                    headers=authorization(token),
                    json={},
                )
                conversation_id = created.json()["id"]
                await service.reply(
                    query="第一问",
                    conversation_id=conversation_id,
                )
                await service.reply(
                    query="第二问",
                    conversation_id=conversation_id,
                )

        # Simulate a sidecar restart: a brand-new service/repository instance
        # over the same database must recover the exact same messages.
        service2 = _real_conversation_service(database, _reply_transport())
        app2 = create_app(
            config=SidecarConfig(bearer_token=token),
            lifecycle=EmptyLifecycle(),
            conversation_service=service2,
        )
        async with app2.router.lifespan_context(app2):
            async with AsyncClient(
                transport=ASGITransport(app=app2),
                base_url="http://sidecar.test",
            ) as client:
                page = await client.get(
                    f"/v1/conversations/{conversation_id}/messages",
                    headers=authorization(token),
                )

        assert page.status_code == 200
        body = page.json()
        assert body["has_more"] is False
        assert body["next_cursor"] is None
        assert [(m["role"], m["content"]) for m in body["messages"]] == [
            ("user", "第一问"),
            ("assistant", "这是回答。"),
            ("user", "第二问"),
            ("assistant", "这是回答。"),
        ]
    finally:
        await database.close()


@pytest.mark.asyncio
async def test_conversation_get_excludes_messages(tmp_path) -> None:
    token = generate_startup_token()
    database = Database(tmp_path / "conversation.sqlite3")
    await database.connect()
    await database.migrate()
    try:
        service = _real_conversation_service(database, _reply_transport())
        app = create_app(
            config=SidecarConfig(bearer_token=token),
            lifecycle=EmptyLifecycle(),
            conversation_service=service,
        )
        async with app.router.lifespan_context(app):
            async with AsyncClient(
                transport=ASGITransport(app=app),
                base_url="http://sidecar.test",
            ) as client:
                created = await client.post(
                    "/v1/conversations",
                    headers=authorization(token),
                    json={},
                )
                conversation_id = created.json()["id"]
                await service.reply(
                    query="第一问",
                    conversation_id=conversation_id,
                )
                meta = await client.get(
                    f"/v1/conversations/{conversation_id}",
                    headers=authorization(token),
                )

        assert meta.status_code == 200
        assert "messages" not in meta.json()
    finally:
        await database.close()


@pytest.mark.asyncio
async def test_conversation_messages_pagination(tmp_path) -> None:
    token = generate_startup_token()
    database = Database(tmp_path / "conversation.sqlite3")
    await database.connect()
    await database.migrate()
    try:
        repository = ConversationRepository(database)
        history = ConversationHistoryStore(database)
        conversation = await repository.create(title="分页会话")
        conversation_id = conversation.id
        for index in range(55):
            await history.append(
                role="user" if index % 2 == 0 else "assistant",
                content=f"消息{index}",
                conversation_id=conversation_id,
            )

        service = _real_conversation_service(database, _reply_transport())
        app = create_app(
            config=SidecarConfig(bearer_token=token),
            lifecycle=EmptyLifecycle(),
            conversation_service=service,
        )
        async with app.router.lifespan_context(app):
            async with AsyncClient(
                transport=ASGITransport(app=app),
                base_url="http://sidecar.test",
            ) as client:
                page1 = await client.get(
                    f"/v1/conversations/{conversation_id}/messages",
                    headers=authorization(token),
                    params={"limit": 50},
                )
                assert page1.status_code == 200
                body1 = page1.json()
                assert len(body1["messages"]) == 50
                assert body1["has_more"] is True
                assert body1["next_cursor"] is not None

                page2 = await client.get(
                    f"/v1/conversations/{conversation_id}/messages",
                    headers=authorization(token),
                    params={"limit": 50, "cursor": body1["next_cursor"]},
                )
                assert page2.status_code == 200
                body2 = page2.json()
                assert len(body2["messages"]) == 5
                assert body2["has_more"] is False
                assert body2["next_cursor"] is None

        contents = [
            message["content"] for message in body1["messages"]
        ] + [message["content"] for message in body2["messages"]]
        assert len(set(contents)) == 55
    finally:
        await database.close()
