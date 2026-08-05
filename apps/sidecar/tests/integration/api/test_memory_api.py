from collections.abc import AsyncIterator
from pathlib import Path

import httpx
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from voxstudio_core.api.app import create_app
from voxstudio_core.config import SidecarConfig, generate_startup_token
from voxstudio_core.knowledge.conversation import ConversationService
from voxstudio_core.knowledge.history import ConversationHistoryStore
from voxstudio_core.knowledge.memory import MemoryService
from voxstudio_core.knowledge.retrieval import KnowledgeRetriever
from voxstudio_core.persistence.conversation_repository import (
    ConversationRepository,
)
from voxstudio_core.persistence.database import Database
from voxstudio_core.persistence.memory_entry_repository import (
    MemoryEntryRepository,
)
from voxstudio_core.providers.local_config import LocalProviderConfig
from voxstudio_core.providers.openai_compatible import OpenAICompatibleClient


class EmptyLifecycle:
    async def startup(self) -> None:
        return None

    async def shutdown(self) -> None:
        return None

    async def current_run(self):
        return None

    async def start_or_resume(self):
        return None


@pytest_asyncio.fixture
async def app_client(
    tmp_path: Path,
) -> AsyncIterator[tuple[AsyncClient, MemoryService, str]]:
    database = Database(tmp_path / "memory_api.sqlite3")
    await database.connect()
    await database.migrate()

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "content": '[{"content":"用户喜欢咖啡",'
                            '"type":"preference","confidence":0.9,'
                            '"sensitive":false}]'
                        }
                    }
                ]
            },
        )

    config = LocalProviderConfig(
        base_url="http://127.0.0.1:11434",
        chat_model="local-chat",
        embedding_model="local-embed",
    )
    client = OpenAICompatibleClient(
        config,
        transport=httpx.MockTransport(handler),
    )
    memory_service = MemoryService(
        repository=MemoryEntryRepository(database),
        chat_client=client,
        chat_model="local-chat",
    )
    conversation_service = ConversationService(
        retriever=KnowledgeRetriever(database),
        chat_client=client,
        chat_model="local-chat",
        history=ConversationHistoryStore(database),
        memory_service=memory_service,
        conversations=ConversationRepository(database),
    )
    token = generate_startup_token()
    app = create_app(
        config=SidecarConfig(bearer_token=token),
        lifecycle=EmptyLifecycle(),
        conversation_service=conversation_service,
        memory_service=memory_service,
    )
    async with app.router.lifespan_context(app):
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://sidecar.test",
        ) as http_client:
            yield http_client, memory_service, token
    await database.close()


def authorization(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_memory_entries_can_be_created_listed_and_read(
    app_client,
) -> None:
    client, service, token = app_client
    entry = await service._repository.create(
        type="user_fact",
        content="用户使用外骨骼",
    )

    listed = await client.get("/v1/memory/entries", headers=authorization(token))
    fetched = await client.get(
        f"/v1/memory/entries/{entry.id}",
        headers=authorization(token),
    )

    assert listed.status_code == 200
    assert listed.json()["total"] == 1
    assert listed.json()["entries"][0]["content"] == "用户使用外骨骼"
    assert fetched.status_code == 200
    assert fetched.json()["id"] == entry.id


@pytest.mark.asyncio
async def test_memory_entries_support_type_filter(app_client) -> None:
    client, service, token = app_client
    await service._repository.create(type="user_fact", content="事实")
    await service._repository.create(type="preference", content="偏好")

    filtered = await client.get(
        "/v1/memory/entries",
        params={"type": "preference"},
        headers=authorization(token),
    )

    assert filtered.status_code == 200
    assert filtered.json()["total"] == 1
    assert filtered.json()["entries"][0]["type"] == "preference"


@pytest.mark.asyncio
async def test_memory_entry_patch_updates_content_and_flags(app_client) -> None:
    client, service, token = app_client
    entry = await service._repository.create(type="user_fact", content="旧内容")

    response = await client.patch(
        f"/v1/memory/entries/{entry.id}",
        headers=authorization(token),
        json={"content": "新内容", "confirmed": True, "sensitive": True},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["content"] == "新内容"
    assert body["confirmed_by_user"] is True
    assert body["sensitive"] is True


@pytest.mark.asyncio
async def test_memory_entry_patch_reject_removes_entry(app_client) -> None:
    client, service, token = app_client
    entry = await service._repository.create(type="user_fact", content="要拒绝的内容")

    response = await client.patch(
        f"/v1/memory/entries/{entry.id}",
        headers=authorization(token),
        json={"reject": True},
    )

    assert response.status_code == 200
    assert await service.list_entries() == ()


@pytest.mark.asyncio
async def test_memory_entry_delete_and_clear(app_client) -> None:
    client, service, token = app_client
    entry = await service._repository.create(type="user_fact", content="内容")

    deleted = await client.delete(
        f"/v1/memory/entries/{entry.id}",
        headers=authorization(token),
    )
    assert deleted.status_code == 200
    assert await service.list_entries() == ()

    await service._repository.create(type="user_fact", content="内容二")
    cleared = await client.post("/v1/memory/clear", headers=authorization(token))
    assert cleared.status_code == 200
    assert await service.list_entries() == ()


@pytest.mark.asyncio
async def test_memory_settings_can_be_toggled(app_client) -> None:
    client, _, token = app_client

    read = await client.get("/v1/memory/settings", headers=authorization(token))
    assert read.status_code == 200
    assert read.json()["enabled"] is True

    updated = await client.put(
        "/v1/memory/settings",
        headers=authorization(token),
        json={"enabled": False},
    )
    assert updated.status_code == 200
    assert updated.json()["enabled"] is False


@pytest.mark.asyncio
async def test_memory_entry_missing_returns_404(app_client) -> None:
    client, _, token = app_client
    response = await client.get(
        "/v1/memory/entries/missing",
        headers=authorization(token),
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_memory_entries_filter_by_source(app_client) -> None:
    client, service, token = app_client
    await service._repository.create(
        type="user_fact", content="显式记忆", source="user"
    )
    await service._repository.create(
        type="preference", content="摘要记忆", source="system"
    )

    filtered = await client.get(
        "/v1/memory/entries",
        params={"source": "user"},
        headers=authorization(token),
    )

    assert filtered.status_code == 200
    assert filtered.json()["total"] == 1
    assert filtered.json()["entries"][0]["source"] == "user"


@pytest.mark.asyncio
async def test_memory_entry_patch_pins_and_disables(app_client) -> None:
    client, service, token = app_client
    entry = await service._repository.create(type="user_fact", content="内容")

    response = await client.patch(
        f"/v1/memory/entries/{entry.id}",
        headers=authorization(token),
        json={"pinned": True, "disabled": True},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["pinned"] is True
    assert body["disabled"] is True


@pytest.mark.asyncio
async def test_memory_entry_permanent_delete_is_verified(app_client) -> None:
    client, service, token = app_client
    entry = await service._repository.create(type="user_fact", content="待删除")

    response = await client.delete(
        f"/v1/memory/entries/{entry.id}/permanent",
        headers=authorization(token),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["deleted"] is True
    assert body["verified"] is True
    assert await service.list_entries() == ()


@pytest.mark.asyncio
async def test_ignore_rules_lifecycle(app_client) -> None:
    client, _, token = app_client

    created = await client.post(
        "/v1/memory/ignore-rules",
        headers=authorization(token),
        json={"type": "preference"},
    )
    assert created.status_code == 200
    rule_id = created.json()["id"]
    assert created.json()["type"] == "preference"

    listed = await client.get(
        "/v1/memory/ignore-rules",
        headers=authorization(token),
    )
    assert listed.status_code == 200
    assert listed.json()["total"] == 1

    deleted = await client.delete(
        f"/v1/memory/ignore-rules/{rule_id}",
        headers=authorization(token),
    )
    assert deleted.status_code == 200

    after = await client.get(
        "/v1/memory/ignore-rules",
        headers=authorization(token),
    )
    assert after.json()["total"] == 0


@pytest.mark.asyncio
async def test_memory_privacy_statement(app_client) -> None:
    client, _, token = app_client
    response = await client.get("/v1/memory/privacy", headers=authorization(token))
    assert response.status_code == 200
    assert "本机" in response.json()["statement"]


@pytest.mark.asyncio
async def test_extraction_failure_does_not_block_a_reply(
    tmp_path: Path,
) -> None:
    database = Database(tmp_path / "extract_fail.sqlite3")
    await database.connect()
    await database.migrate()

    def handler(request: httpx.Request) -> httpx.Response:
        prompt = request.content.decode()
        if "Extract any long-term memory" in prompt:
            return httpx.Response(500, json={"error": "boom"})
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": "正常回答"}}]},
        )

    config = LocalProviderConfig(
        base_url="http://127.0.0.1:11434",
        chat_model="local-chat",
        embedding_model="local-embed",
    )
    client = OpenAICompatibleClient(
        config,
        transport=httpx.MockTransport(handler),
    )
    memory_service = MemoryService(
        repository=MemoryEntryRepository(database),
        chat_client=client,
        chat_model="local-chat",
    )
    conversation_service = ConversationService(
        retriever=KnowledgeRetriever(database),
        chat_client=client,
        chat_model="local-chat",
        history=ConversationHistoryStore(database),
        memory_service=memory_service,
        conversations=ConversationRepository(database),
    )
    token = generate_startup_token()
    app = create_app(
        config=SidecarConfig(bearer_token=token),
        lifecycle=EmptyLifecycle(),
        conversation_service=conversation_service,
        memory_service=memory_service,
    )
    async with app.router.lifespan_context(app):
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://sidecar.test",
        ) as http_client:
            response = await http_client.post(
                "/v1/conversation/replies",
                headers=authorization(token),
                json={"query": "你好"},
            )
    await database.close()

    assert response.status_code == 200
    assert response.json()["text"] == "正常回答"
