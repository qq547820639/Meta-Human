from dataclasses import dataclass

from voxstudio_core.knowledge.sync import freshness_for
from voxstudio_core.persistence.database import Database


@dataclass(frozen=True, slots=True)
class KnowledgeSourceEntry:
    document_id: str
    title: str
    source_url: str | None
    synced_at: str | None
    chunk_count: int
    enabled: bool = True
    status: str = "ready"
    freshness: str = "never"
    sync_progress: float = 0.0
    sync_stage: str | None = None
    last_error: str | None = None


class KnowledgeSourceStore:
    def __init__(self, database: Database) -> None:
        self._database = database

    async def list_sources(
        self,
        *,
        limit: int = 100,
        offset: int = 0,
    ) -> tuple[KnowledgeSourceEntry, ...]:
        if limit < 1:
            raise ValueError("limit must be >= 1")
        if offset < 0:
            raise ValueError("offset must be >= 0")
        async with self._database.transaction(immediate=False) as connection:
            async with connection.execute(
                """
                SELECT
                    d.id AS document_id,
                    d.title AS title,
                    d.source_url AS source_url,
                    d.synced_at AS synced_at,
                    d.enabled AS enabled,
                    d.status AS status,
                    d.last_error AS last_error,
                    d.sync_stage AS sync_stage,
                    d.sync_progress AS sync_progress,
                    COUNT(c.id) AS chunk_count
                FROM knowledge_documents d
                LEFT JOIN knowledge_chunks c ON c.document_id = d.id
                GROUP BY d.id
                ORDER BY d.synced_at DESC, d.id
                LIMIT ? OFFSET ?
                """,
                (limit, offset),
            ) as cursor:
                rows = await cursor.fetchall()
        return tuple(
            KnowledgeSourceEntry(
                document_id=row["document_id"],
                title=row["title"],
                source_url=row["source_url"],
                synced_at=row["synced_at"],
                chunk_count=row["chunk_count"],
                enabled=bool(row["enabled"]),
                status=row["status"],
                freshness=freshness_for(row["synced_at"]),
                sync_progress=float(row["sync_progress"] or 0),
                sync_stage=row["sync_stage"],
                last_error=row["last_error"],
            )
            for row in rows
        )

    async def count_sources(self) -> int:
        async with self._database.transaction(immediate=False) as connection:
            async with connection.execute(
                "SELECT COUNT(*) AS total FROM knowledge_documents"
            ) as cursor:
                row = await cursor.fetchone()
        return int(row["total"]) if row is not None else 0

    async def get_source(self, *, document_id: str) -> KnowledgeSourceEntry | None:
        async with self._database.transaction(immediate=False) as connection:
            async with connection.execute(
                """
                SELECT
                    d.id AS document_id,
                    d.title AS title,
                    d.source_url AS source_url,
                    d.synced_at AS synced_at,
                    d.enabled AS enabled,
                    d.status AS status,
                    d.last_error AS last_error,
                    d.sync_stage AS sync_stage,
                    d.sync_progress AS sync_progress,
                    COUNT(c.id) AS chunk_count
                FROM knowledge_documents d
                LEFT JOIN knowledge_chunks c ON c.document_id = d.id
                WHERE d.id = ?
                GROUP BY d.id
                """,
                (document_id,),
            ) as cursor:
                row = await cursor.fetchone()
        if row is None:
            return None
        return KnowledgeSourceEntry(
            document_id=row["document_id"],
            title=row["title"],
            source_url=row["source_url"],
            synced_at=row["synced_at"],
            chunk_count=row["chunk_count"],
            enabled=bool(row["enabled"]),
            status=row["status"],
            freshness=freshness_for(row["synced_at"]),
            sync_progress=float(row["sync_progress"] or 0),
            sync_stage=row["sync_stage"],
            last_error=row["last_error"],
        )

    async def set_enabled(self, *, document_id: str, enabled: bool) -> bool:
        async with self._database.transaction() as connection:
            cursor = await connection.execute(
                """
                UPDATE knowledge_documents
                SET enabled = ?, status = ?
                WHERE id = ?
                """,
                (1 if enabled else 0, "ready" if enabled else "paused", document_id),
            )
            return cursor.rowcount == 1

    async def delete_source(self, *, document_id: str) -> bool:
        async with self._database.transaction() as connection:
            cursor = await connection.execute(
                "DELETE FROM knowledge_documents WHERE id = ?",
                (document_id,),
            )
            return cursor.rowcount == 1
