from dataclasses import dataclass

from voxstudio_core.persistence.database import Database


@dataclass(frozen=True, slots=True)
class KnowledgeSourceEntry:
    document_id: str
    title: str
    source_url: str | None
    synced_at: str | None
    chunk_count: int


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

    async def delete_source(self, *, document_id: str) -> bool:
        async with self._database.transaction() as connection:
            cursor = await connection.execute(
                "DELETE FROM knowledge_documents WHERE id = ?",
                (document_id,),
            )
            return cursor.rowcount == 1
