from contextlib import asynccontextmanager
from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

from voxstudio_core.api.app import create_app
from voxstudio_core.config import SidecarConfig, generate_startup_token
from voxstudio_core.knowledge.history import ConversationHistoryStore
from voxstudio_core.knowledge.indexer import KnowledgeIndexer
from voxstudio_core.knowledge.memory import ConversationMemoryStore
from voxstudio_core.persistence.database import Database


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
    database: Database,
) -> AsyncIterator[AsyncClient]:
    app = create_app(
        config=SidecarConfig(bearer_token=token),
        lifecycle=EmptyLifecycle(),
        privacy_database=database,
    )
    async with app.router.lifespan_context(app):
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://sidecar.test",
        ) as client:
            yield client


@pytest.mark.asyncio
async def test_clear_local_data_removes_conversation_memory_and_knowledge(
    tmp_path: Path,
) -> None:
    token = generate_startup_token()
    database = Database(tmp_path / "privacy.sqlite3")
    await database.connect()
    await database.migrate()
    try:
        await ConversationHistoryStore(database).append(
            role="user",
            content="第一问",
        )
        await ConversationMemoryStore(database).save(summary="摘要")
        await KnowledgeIndexer(database).upsert_document(
            document_id="doc-1",
            title="Guide",
            content="Paragraph.",
        )

        async with running_client(token, database) as client:
            response = await client.delete(
                "/v1/privacy/data",
                headers={"Authorization": f"Bearer {token}"},
            )

        assert response.status_code == 200
        assert response.json() == {"cleared": True}
        assert await ConversationHistoryStore(database).list_recent() == ()
        assert await ConversationMemoryStore(database).load_latest() is None
        assert await KnowledgeIndexer(database).delete_document(
            document_id="doc-1"
        ) is False
    finally:
        await database.close()


@pytest.mark.asyncio
async def test_clear_local_data_requires_bearer_token(
    tmp_path: Path,
) -> None:
    token = generate_startup_token()
    database = Database(tmp_path / "privacy-auth.sqlite3")
    await database.connect()
    await database.migrate()
    try:
        async with running_client(token, database) as client:
            response = await client.delete("/v1/privacy/data")
        assert response.status_code == 401
    finally:
        await database.close()
