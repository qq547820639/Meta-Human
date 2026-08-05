from dataclasses import dataclass
import re
import sqlite3
import unicodedata

from voxstudio_core.persistence.database import Database


@dataclass(frozen=True, slots=True)
class RetrievedPassage:
    document_id: str
    title: str
    content: str
    score: int
    source_url: str | None = None
    updated_at: str | None = None

    def citation(self) -> str:
        return f"[{self.title}]"


class KnowledgeRetriever:
    def __init__(self, database: Database) -> None:
        self._database = database

    async def search(
        self,
        *,
        query: str,
        limit: int = 3,
    ) -> tuple[RetrievedPassage, ...]:
        query_terms = _terms(query)
        fts_passages = await self._search_fts(query=query, limit=limit)
        if fts_passages:
            return fts_passages
        if not query_terms:
            return ()

        async with self._database.transaction(immediate=False) as connection:
            async with connection.execute(
                """
                SELECT
                    d.id AS document_id,
                    d.title AS title,
                    c.content AS content,
                    d.source_url AS source_url,
                    d.synced_at AS updated_at
                FROM knowledge_chunks c
                JOIN knowledge_documents d ON d.id = c.document_id
                ORDER BY c.document_id, c.position
                """
            ) as cursor:
                rows = await cursor.fetchall()

        scored: list[RetrievedPassage] = []
        for row in rows:
            content_terms = _terms(row["content"])
            title_terms = _terms(row["title"])
            score = len(query_terms & content_terms) + len(
                query_terms & title_terms
            )
            if score == 0:
                continue
            scored.append(
                RetrievedPassage(
                    document_id=row["document_id"],
                    title=row["title"],
                    content=row["content"],
                    score=score,
                    source_url=row["source_url"],
                    updated_at=row["updated_at"],
                )
            )

        scored.sort(key=lambda passage: (-passage.score, passage.title))
        return tuple(scored[:limit])

    async def _search_fts(
        self,
        *,
        query: str,
        limit: int,
    ) -> tuple[RetrievedPassage, ...]:
        if not query.strip():
            return ()
        fts_query = '"' + query.replace('"', '""') + '"'
        try:
            async with self._database.transaction(
                immediate=False
            ) as connection:
                async with connection.execute(
                    """
                    SELECT
                        d.id AS document_id,
                        d.title AS title,
                        d.source_url AS source_url,
                        d.synced_at AS updated_at,
                        c.content AS content
                    FROM knowledge_chunks_fts f
                    JOIN knowledge_chunks c ON c.id = f.rowid
                    JOIN knowledge_documents d ON d.id = c.document_id
                    WHERE knowledge_chunks_fts MATCH ?
                    ORDER BY rank
                    LIMIT ?
                    """,
                    (fts_query, limit),
                ) as cursor:
                    rows = await cursor.fetchall()
        except sqlite3.OperationalError:
            return ()
        query_terms = _terms(query)
        return tuple(
            RetrievedPassage(
                document_id=row["document_id"],
                title=row["title"],
                content=row["content"],
                score=(
                    len(query_terms & _terms(row["title"])) + 1
                ),
                source_url=row["source_url"],
                updated_at=row["updated_at"],
            )
            for row in rows
        )


def _terms(value: str) -> set[str]:
    normalized = unicodedata.normalize("NFKC", value).casefold()
    latin_terms = set(re.findall(r"[a-z0-9]+", normalized))
    han_chars = [character for character in normalized if _is_han(character)]
    cjk_terms = set(han_chars)
    cjk_terms.update(
        left + right
        for left, right in zip(han_chars, han_chars[1:])
    )
    return latin_terms | cjk_terms


def _is_han(character: str) -> bool:
    codepoint = ord(character)
    return (
        0x3400 <= codepoint <= 0x4DBF
        or 0x4E00 <= codepoint <= 0x9FFF
    )
