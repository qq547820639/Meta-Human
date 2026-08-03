from datetime import UTC, datetime
from hashlib import sha256

from voxstudio_core.persistence.database import Database


class KnowledgeIndexer:
    def __init__(self, database: Database) -> None:
        self._database = database

    async def upsert_document(
        self,
        *,
        document_id: str,
        title: str,
        content: str,
        source_url: str | None = None,
        synced_at: datetime | None = None,
    ) -> int:
        resolved_synced_at = synced_at or datetime.now(UTC)
        chunks = _chunk_text(content)
        content_hash = sha256(content.encode("utf-8")).hexdigest()

        async with self._database.transaction() as connection:
            await connection.execute(
                "DELETE FROM knowledge_documents WHERE id = ?",
                (document_id,),
            )
            await connection.execute(
                """
                INSERT INTO knowledge_documents (
                    id, title, source_url, content_hash, synced_at
                ) VALUES (?, ?, ?, ?, ?)
                """,
                (
                    document_id,
                    title,
                    source_url,
                    content_hash,
                    _serialize_timestamp(resolved_synced_at),
                ),
            )
            for position, chunk in enumerate(chunks):
                await connection.execute(
                    """
                    INSERT INTO knowledge_chunks (
                        document_id, position, content
                    ) VALUES (?, ?, ?)
                    """,
                    (document_id, position, chunk),
                )
        return len(chunks)

    async def delete_document(self, *, document_id: str) -> bool:
        async with self._database.transaction() as connection:
            cursor = await connection.execute(
                "DELETE FROM knowledge_documents WHERE id = ?",
                (document_id,),
            )
            return cursor.rowcount == 1


def _chunk_text(text: str, *, max_chars: int = 500) -> tuple[str, ...]:
    paragraphs = [
        paragraph.strip()
        for paragraph in text.splitlines()
        if paragraph.strip()
    ]
    if not paragraphs:
        return ()

    chunks: list[str] = []
    for paragraph in paragraphs:
        if len(paragraph) <= max_chars:
            chunks.append(paragraph)
            continue
        start = 0
        while start < len(paragraph):
            chunks.append(paragraph[start : start + max_chars])
            start += max_chars
    return tuple(chunks)


def _serialize_timestamp(value: datetime) -> str:
    return value.astimezone(UTC).isoformat()
