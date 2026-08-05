"""Incremental-sync progress/status modelling for knowledge sources.

A source document lives in ``knowledge_documents`` and carries a small set of
sync-visible columns (``enabled``, ``status``, ``last_error``, ``sync_stage``,
``sync_progress``, ``sync_started_at``, ``sync_finished_at``).  This module owns
the state transitions (start / progress / complete / fail / pause / resume) and
the freshness judgement, keeping the raw SQL out of the API layer.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from enum import Enum, StrEnum

from voxstudio_core.persistence.database import Database

#: Default age (in days) after which a synced document is considered stale.
DEFAULT_STALE_AFTER_DAYS = 7


class SyncStatus(StrEnum):
    PENDING = "pending"
    SYNCING = "syncing"
    READY = "ready"
    FAILED = "failed"
    PAUSED = "paused"


@dataclass(frozen=True, slots=True)
class KnowledgeSyncState:
    document_id: str
    status: SyncStatus
    enabled: bool
    progress: float
    stage: str | None = None
    last_error: str | None = None

    @property
    def is_syncing(self) -> bool:
        return self.status is SyncStatus.SYNCING

    @property
    def is_failed(self) -> bool:
        return self.status is SyncStatus.FAILED

    @property
    def is_paused(self) -> bool:
        return self.status is SyncStatus.PAUSED


class KnowledgeSyncService:
    """Persists and advances the sync state of a knowledge document."""

    def __init__(
        self,
        database: Database,
        *,
        stale_after_days: int = DEFAULT_STALE_AFTER_DAYS,
    ) -> None:
        self._database = database
        self._stale_after_days = stale_after_days

    # -- state read ----------------------------------------------------------

    async def get_state(self, *, document_id: str) -> KnowledgeSyncState | None:
        async with self._database.transaction(immediate=False) as connection:
            async with connection.execute(
                """
                SELECT
                    id, enabled, status, last_error,
                    sync_stage, sync_progress
                FROM knowledge_documents
                WHERE id = ?
                """,
                (document_id,),
            ) as cursor:
                row = await cursor.fetchone()
        if row is None:
            return None
        return KnowledgeSyncState(
            document_id=row["id"],
            status=SyncStatus(row["status"]),
            enabled=bool(row["enabled"]),
            progress=float(row["sync_progress"] or 0),
            stage=row["sync_stage"],
            last_error=row["last_error"],
        )

    # -- state transitions ---------------------------------------------------

    async def start_sync(self, *, document_id: str) -> KnowledgeSyncState | None:
        """Begin an incremental sync: reset progress to 0 and clear errors."""
        now = _now()
        if not await self._update(
            document_id=document_id,
            status=SyncStatus.SYNCING.value,
            last_error=None,
            sync_stage="starting",
            sync_progress=0,
            sync_started_at=now,
            sync_finished_at=None,
        ):
            return None
        return await self.get_state(document_id=document_id)

    async def update_progress(
        self,
        *,
        document_id: str,
        stage: str,
        progress: float,
    ) -> KnowledgeSyncState | None:
        progress = max(0.0, min(100.0, float(progress)))
        if not await self._update(
            document_id=document_id,
            sync_stage=stage,
            sync_progress=progress,
        ):
            return None
        return await self.get_state(document_id=document_id)

    async def complete_sync(self, *, document_id: str) -> KnowledgeSyncState | None:
        """Mark the document freshly synced at 100% with no error."""
        if not await self._update(
            document_id=document_id,
            status=SyncStatus.READY.value,
            last_error=None,
            sync_stage="done",
            sync_progress=100,
            sync_finished_at=_now(),
        ):
            return None
        return await self.get_state(document_id=document_id)

    async def fail_sync(
        self,
        *,
        document_id: str,
        error: str,
    ) -> KnowledgeSyncState | None:
        if not await self._update(
            document_id=document_id,
            status=SyncStatus.FAILED.value,
            last_error=humanize_error(error),
            sync_stage="failed",
            sync_finished_at=_now(),
        ):
            return None
        return await self.get_state(document_id=document_id)

    async def set_enabled(
        self,
        *,
        document_id: str,
        enabled: bool,
    ) -> KnowledgeSyncState | None:
        """Enable or pause (disable) a single document.

        Pausing freezes the document out of retrieval without deleting it;
        enabling resumes it back to ``ready``.
        """
        current = await self.get_state(document_id=document_id)
        if current is None:
            return None
        status = (
            SyncStatus.READY.value
            if enabled
            else SyncStatus.PAUSED.value
        )
        if not await self._update(
            document_id=document_id,
            enabled=1 if enabled else 0,
            status=status,
            sync_stage=None if enabled else "paused",
        ):
            return None
        return await self.get_state(document_id=document_id)

    async def resync(self, *, document_id: str) -> KnowledgeSyncState | None:
        """Force a fresh incremental sync of a single document."""
        return await self.start_sync(document_id=document_id)

    # -- freshness -----------------------------------------------------------

    def freshness_for(
        self,
        *,
        synced_at: str | None,
        now: datetime | None = None,
    ) -> str:
        """Classify a document as ``fresh``, ``stale`` or ``never`` synced."""
        return freshness_for(
            synced_at,
            now=now,
            stale_after_days=self._stale_after_days,
        )

    # -- internals -----------------------------------------------------------

    async def _update(
        self,
        *,
        document_id: str,
        **fields: object,
    ) -> bool:
        if not fields:
            return await self._exists(document_id)
        assignments = ", ".join(f"{key} = ?" for key in fields)
        values = [_coerce(fields[key]) for key in fields]
        values.append(document_id)
        async with self._database.transaction() as connection:
            cursor = await connection.execute(
                f"UPDATE knowledge_documents SET {assignments} WHERE id = ?",
                tuple(values),
            )
            return cursor.rowcount == 1

    async def _exists(self, document_id: str) -> bool:
        async with self._database.transaction(immediate=False) as connection:
            async with connection.execute(
                "SELECT 1 FROM knowledge_documents WHERE id = ?",
                (document_id,),
            ) as cursor:
                row = await cursor.fetchone()
        return row is not None


def freshness_for(
    synced_at: str | None,
    *,
    now: datetime | None = None,
    stale_after_days: int = DEFAULT_STALE_AFTER_DAYS,
) -> str:
    """Return ``fresh``, ``stale`` or ``never`` for a document's sync time."""
    if not synced_at:
        return "never"
    try:
        synced = datetime.fromisoformat(synced_at)
        if synced.tzinfo is None:
            synced = synced.replace(tzinfo=UTC)
        synced = synced.astimezone(UTC)
    except ValueError:
        return "unknown"
    resolved_now = (now or datetime.now(UTC)).astimezone(UTC)
    if resolved_now - synced <= timedelta(days=stale_after_days):
        return "fresh"
    return "stale"


def humanize_error(error: str) -> str:
    """Turn a raw exception message into a short, readable Chinese message."""
    lowered = error.casefold()
    if not error.strip():
        return "未知同步错误"
    if "401" in lowered or "unauthorized" in lowered or "凭证" in lowered:
        return "知识源授权失效，请重新授权飞书"
    if "403" in lowered or "forbidden" in lowered or "无权限" in lowered:
        return "没有访问该知识源的权限"
    if "404" in lowered or "not found" in lowered:
        return "知识源不存在或已被删除"
    if "timeout" in lowered or "timed out" in lowered:
        return "同步超时，请检查网络后重试"
    if "empty" in lowered or "空" in lowered:
        return "文档内容为空，跳过同步"
    if "network" in lowered or "connection" in lowered or "网络" in lowered:
        return "网络连接失败，请检查网络"
    return error[:120]


def _coerce(value: object) -> object:
    if isinstance(value, Enum):
        return value.value
    return value


def _now() -> str:
    return datetime.now(UTC).isoformat()
