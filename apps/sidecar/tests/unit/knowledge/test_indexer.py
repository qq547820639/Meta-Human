from collections.abc import AsyncIterator
from pathlib import Path

import aiosqlite
import pytest
import pytest_asyncio

from voxstudio_core.knowledge.indexer import KnowledgeIndexer
from voxstudio_core.persistence.database import Database


@pytest_asyncio.fixture
async def database(tmp_path: Path) -> AsyncIterator[Database]:
    database = Database(tmp_path / "knowledge.sqlite3")
    await database.connect()
    await database.migrate()
    try:
        yield database
    finally:
        await database.close()


@pytest.mark.asyncio
async def test_upsert_creates_chunks_and_replaces_previous_content(
    database: Database,
) -> None:
    indexer = KnowledgeIndexer(database)

    first_count = await indexer.upsert_document(
        document_id="doc-1",
        title="Guide",
        content="First paragraph.\nSecond paragraph.",
    )
    second_count = await indexer.upsert_document(
        document_id="doc-1",
        title="Guide",
        content="Replacement paragraph.",
    )

    assert first_count == 2
    assert second_count == 1
    async with aiosqlite.connect(database.path) as connection:
        connection.row_factory = aiosqlite.Row
        async with connection.execute(
            "SELECT content FROM knowledge_chunks WHERE document_id = ?",
            ("doc-1",),
        ) as cursor:
            rows = await cursor.fetchall()
    assert [row["content"] for row in rows] == ["Replacement paragraph."]


@pytest.mark.asyncio
async def test_delete_document_cascades_chunks(database: Database) -> None:
    indexer = KnowledgeIndexer(database)
    await indexer.upsert_document(
        document_id="doc-1",
        title="Guide",
        content="One paragraph.",
    )

    deleted = await indexer.delete_document(document_id="doc-1")

    assert deleted is True
    async with aiosqlite.connect(database.path) as connection:
        async with connection.execute(
            "SELECT COUNT(*) FROM knowledge_chunks WHERE document_id = ?",
            ("doc-1",),
        ) as cursor:
            chunk_count = (await cursor.fetchone())[0]
    assert chunk_count == 0


@pytest.mark.asyncio
async def test_delete_missing_document_returns_false(
    database: Database,
) -> None:
    deleted = await KnowledgeIndexer(database).delete_document(
        document_id="missing"
    )

    assert deleted is False
