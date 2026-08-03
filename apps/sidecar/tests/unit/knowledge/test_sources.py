from collections.abc import AsyncIterator
from pathlib import Path

import pytest
import pytest_asyncio

from voxstudio_core.knowledge.indexer import KnowledgeIndexer
from voxstudio_core.knowledge.sources import KnowledgeSourceStore
from voxstudio_core.persistence.database import Database


@pytest_asyncio.fixture
async def database(tmp_path: Path) -> AsyncIterator[Database]:
    database = Database(tmp_path / "sources.sqlite3")
    await database.connect()
    await database.migrate()
    indexer = KnowledgeIndexer(database)
    await indexer.upsert_document(
        document_id="doc-1",
        title="Guide",
        content="First paragraph.\nSecond paragraph.",
        source_url="https://feishu.cn/docx/doc-1",
    )
    try:
        yield database
    finally:
        await database.close()


@pytest.mark.asyncio
async def test_list_sources_returns_documents_with_chunk_counts(
    database: Database,
) -> None:
    sources = await KnowledgeSourceStore(database).list_sources()

    assert len(sources) == 1
    assert sources[0].document_id == "doc-1"
    assert sources[0].title == "Guide"
    assert sources[0].source_url == "https://feishu.cn/docx/doc-1"
    assert sources[0].chunk_count == 2


@pytest.mark.asyncio
async def test_delete_source_removes_document_and_chunks(
    database: Database,
) -> None:
    store = KnowledgeSourceStore(database)

    deleted = await store.delete_source(document_id="doc-1")

    assert deleted is True
    assert await store.list_sources() == ()
