from collections.abc import AsyncIterator
from pathlib import Path

import pytest
import pytest_asyncio

from voxstudio_core.knowledge.indexer import KnowledgeIndexer
from voxstudio_core.knowledge.sources import KnowledgeSourceStore
from voxstudio_core.knowledge.sync import SyncStatus, KnowledgeSyncService
from voxstudio_core.persistence.database import Database


@pytest_asyncio.fixture
async def database(tmp_path: Path) -> AsyncIterator[Database]:
    db = Database(tmp_path / "single.sqlite3")
    await db.connect()
    await db.migrate()
    indexer = KnowledgeIndexer(db)
    await indexer.upsert_document(
        document_id="doc-1",
        title="Guide",
        content="Exoskeleton rear-entry mechanism.",
        source_url="https://feishu.cn/docx/doc-1",
    )
    try:
        yield db
    finally:
        await db.close()


@pytest.mark.asyncio
async def test_list_sources_exposes_sync_fields(database: Database) -> None:
    sources = await KnowledgeSourceStore(database).list_sources()

    assert len(sources) == 1
    source = sources[0]
    assert source.enabled is True
    assert source.status == "ready"
    assert source.freshness == "fresh"
    assert source.sync_progress == 0
    assert source.last_error is None


@pytest.mark.asyncio
async def test_pause_document_via_store(database: Database) -> None:
    store = KnowledgeSourceStore(database)

    updated = await store.set_enabled(document_id="doc-1", enabled=False)

    assert updated is True
    source = await store.get_source(document_id="doc-1")
    assert source is not None
    assert source.enabled is False
    assert source.status == "paused"


@pytest.mark.asyncio
async def test_pause_then_resync_then_delete(database: Database) -> None:
    store = KnowledgeSourceStore(database)
    sync = KnowledgeSyncService(database)

    # resync requires an existing document; complete first to exercise the path
    await sync.complete_sync(document_id="doc-1")
    await sync.set_enabled(document_id="doc-1", enabled=False)
    assert (await store.get_source(document_id="doc-1")).status == "paused"

    restarted = await sync.resync(document_id="doc-1")
    assert restarted is not None
    assert restarted.status is SyncStatus.SYNCING

    deleted = await store.delete_source(document_id="doc-1")
    assert deleted is True
    assert await store.get_source(document_id="doc-1") is None
    assert await store.count_sources() == 0


@pytest.mark.asyncio
async def test_enable_missing_document_returns_false(database: Database) -> None:
    updated = await KnowledgeSourceStore(database).set_enabled(
        document_id="missing", enabled=True
    )

    assert updated is False
