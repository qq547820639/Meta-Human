from contextlib import asynccontextmanager
from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

from voxstudio_core.api.app import create_app
from voxstudio_core.config import SidecarConfig, generate_startup_token
from voxstudio_core.knowledge.indexer import KnowledgeIndexer
from voxstudio_core.knowledge.sources import KnowledgeSourceStore
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
        knowledge_sources=KnowledgeSourceStore(database),
    )
    async with app.router.lifespan_context(app):
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://sidecar.test",
        ) as client:
            yield client


@pytest.mark.asyncio
async def test_knowledge_sources_can_be_listed_and_deleted(
    tmp_path: Path,
) -> None:
    token = generate_startup_token()
    database = Database(tmp_path / "api-sources.sqlite3")
    await database.connect()
    await database.migrate()
    try:
        await KnowledgeIndexer(database).upsert_document(
            document_id="doc-1",
            title="Guide",
            content="First paragraph.\nSecond paragraph.",
            source_url="https://feishu.cn/docx/doc-1",
        )
        async with running_client(token, database) as client:
            headers = {"Authorization": f"Bearer {token}"}
            listed = await client.get(
                "/v1/knowledge/sources",
                headers=headers,
            )
            deleted = await client.delete(
                "/v1/knowledge/sources/doc-1",
                headers=headers,
            )
            empty = await client.get(
                "/v1/knowledge/sources",
                headers=headers,
            )

        assert listed.status_code == 200
        assert listed.json()["sources"][0]["title"] == "Guide"
        assert deleted.status_code == 204
        assert empty.json() == {"sources": []}
    finally:
        await database.close()


@pytest.mark.asyncio
async def test_knowledge_sources_require_bearer_token(
    tmp_path: Path,
) -> None:
    token = generate_startup_token()
    database = Database(tmp_path / "api-sources-auth.sqlite3")
    await database.connect()
    await database.migrate()
    try:
        async with running_client(token, database) as client:
            response = await client.get("/v1/knowledge/sources")
        assert response.status_code == 401
    finally:
        await database.close()
