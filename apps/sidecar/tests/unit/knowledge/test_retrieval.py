from collections.abc import AsyncIterator
from pathlib import Path

import pytest
import pytest_asyncio

from voxstudio_core.knowledge.indexer import KnowledgeIndexer
from voxstudio_core.knowledge.retrieval import KnowledgeRetriever
from voxstudio_core.persistence.database import Database


@pytest_asyncio.fixture
async def indexed_database(tmp_path: Path) -> AsyncIterator[Database]:
    database = Database(tmp_path / "retrieval.sqlite3")
    await database.connect()
    await database.migrate()
    indexer = KnowledgeIndexer(database)
    await indexer.upsert_document(
        document_id="doc-1",
        title="Wearable Guide",
        content="The exoskeleton uses a rear-entry mechanism.",
        source_url="https://feishu.cn/docx/doc-1",
    )
    await indexer.upsert_document(
        document_id="doc-2",
        title="Maintenance",
        content="Lubricate the linear rails each month.",
    )
    try:
        yield database
    finally:
        await database.close()


@pytest.mark.asyncio
async def test_search_returns_relevant_passages_with_citations(
    indexed_database: Database,
) -> None:
    retriever = KnowledgeRetriever(indexed_database)

    passages = await retriever.search(query="rear entry mechanism")

    assert len(passages) == 1
    assert passages[0].document_id == "doc-1"
    assert passages[0].score > 0
    assert passages[0].citation() == "[Wearable Guide]"
    assert passages[0].source_url == "https://feishu.cn/docx/doc-1"


@pytest.mark.asyncio
async def test_search_returns_empty_for_no_match(
    indexed_database: Database,
) -> None:
    passages = await KnowledgeRetriever(indexed_database).search(
        query="unrelated topic"
    )

    assert passages == ()


@pytest.mark.asyncio
async def test_search_respects_limit(
    indexed_database: Database,
) -> None:
    await KnowledgeIndexer(indexed_database).upsert_document(
        document_id="doc-3",
        title="Mechanism Notes",
        content="rear entry mechanism rear entry mechanism",
    )
    retriever = KnowledgeRetriever(indexed_database)

    passages = await retriever.search(query="rear mechanism", limit=2)

    assert len(passages) == 2


@pytest.mark.asyncio
async def test_search_matches_chinese_documents(
    tmp_path: Path,
) -> None:
    database = Database(tmp_path / "chinese-retrieval.sqlite3")
    await database.connect()
    await database.migrate()
    try:
        indexer = KnowledgeIndexer(database)
        await indexer.upsert_document(
            document_id="doc-cn-1",
            title="项目验收手册",
            content="数字人应用需要支持中文知识问答，并引用飞书文档作为来源。",
        )
        await indexer.upsert_document(
            document_id="doc-cn-2",
            title="设备维护说明",
            content="每周检查导轨润滑情况。",
        )
        retriever = KnowledgeRetriever(database)

        passages = await retriever.search(query="数字人中文知识问答", limit=3)

        assert len(passages) == 1
        assert passages[0].document_id == "doc-cn-1"
        assert passages[0].citation() == "[项目验收手册]"
    finally:
        await database.close()
