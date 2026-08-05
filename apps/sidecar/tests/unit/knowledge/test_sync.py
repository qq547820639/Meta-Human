from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
import pytest_asyncio

from voxstudio_core.knowledge.indexer import KnowledgeIndexer
from voxstudio_core.knowledge.sync import (
    KnowledgeSyncService,
    SyncStatus,
    freshness_for,
    humanize_error,
)
from voxstudio_core.persistence.database import Database


@pytest_asyncio.fixture
async def database(tmp_path: Path) -> AsyncIterator[Database]:
    db = Database(tmp_path / "sync.sqlite3")
    await db.connect()
    await db.migrate()
    await KnowledgeIndexer(db).upsert_document(
        document_id="doc-1",
        title="Guide",
        content="Intro paragraph.",
    )
    try:
        yield db
    finally:
        await db.close()


@pytest.mark.asyncio
async def test_sync_progress_lifecycle(database: Database) -> None:
    service = KnowledgeSyncService(database)

    started = await service.start_sync(document_id="doc-1")
    assert started is not None
    assert started.status is SyncStatus.SYNCING
    assert started.progress == 0
    assert started.stage == "starting"

    mid = await service.update_progress(
        document_id="doc-1", stage="downloading", progress=42
    )
    assert mid is not None
    assert mid.progress == 42
    assert mid.stage == "downloading"

    done = await service.complete_sync(document_id="doc-1")
    assert done is not None
    assert done.status is SyncStatus.READY
    assert done.progress == 100
    assert done.stage == "done"
    assert done.last_error is None


@pytest.mark.asyncio
async def test_fail_sync_records_human_error(database: Database) -> None:
    service = KnowledgeSyncService(database)

    failed = await service.fail_sync(
        document_id="doc-1", error="HTTP 401 Unauthorized"
    )

    assert failed is not None
    assert failed.status is SyncStatus.FAILED
    assert failed.is_failed is True
    assert "授权失效" in failed.last_error


@pytest.mark.asyncio
async def test_pause_and_resume_via_set_enabled(database: Database) -> None:
    service = KnowledgeSyncService(database)

    paused = await service.set_enabled(document_id="doc-1", enabled=False)
    assert paused is not None
    assert paused.enabled is False
    assert paused.status is SyncStatus.PAUSED
    assert paused.is_paused is True

    resumed = await service.set_enabled(document_id="doc-1", enabled=True)
    assert resumed is not None
    assert resumed.enabled is True
    assert resumed.status is SyncStatus.READY


@pytest.mark.asyncio
async def test_resync_restarts_pipeline(database: Database) -> None:
    service = KnowledgeSyncService(database)
    await service.complete_sync(document_id="doc-1")

    restarted = await service.resync(document_id="doc-1")

    assert restarted is not None
    assert restarted.status is SyncStatus.SYNCING
    assert restarted.progress == 0


@pytest.mark.asyncio
async def test_get_state_missing_document_returns_none(database: Database) -> None:
    state = await KnowledgeSyncService(database).get_state(
        document_id="missing"
    )

    assert state is None


def test_freshness_for_fresh_and_stale() -> None:
    now = datetime.now(UTC)
    fresh = (now - timedelta(days=2)).isoformat()
    stale = (now - timedelta(days=30)).isoformat()

    assert freshness_for(fresh) == "fresh"
    assert freshness_for(stale) == "stale"
    assert freshness_for(None) == "never"


def test_humanize_error_mappings() -> None:
    assert "授权失效" in humanize_error("401 Unauthorized")
    assert "超时" in humanize_error("request timed out")
    assert "不存在" in humanize_error("404 not found")
    assert humanize_error("") == "未知同步错误"
