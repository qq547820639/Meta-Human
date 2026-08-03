from dataclasses import dataclass
import json

from voxstudio_core.persistence.database import Database


@dataclass(frozen=True, slots=True)
class ConversationMessage:
    role: str
    content: str
    citations: tuple[str, ...] = ()
    citation_urls: tuple[str | None, ...] = ()
    grounded: bool = False
    created_at: str | None = None


class ConversationHistoryStore:
    def __init__(self, database: Database) -> None:
        self._database = database

    async def list_recent(
        self,
        *,
        limit: int = 10,
        conversation_id: str | None = None,
    ) -> tuple[ConversationMessage, ...]:
        if limit <= 0:
            return ()
        where = ""
        params: list[object] = []
        if conversation_id is not None:
            where = "WHERE conversation_id = ?"
            params.append(conversation_id)
        params.append(limit)
        async with self._database.transaction(immediate=False) as connection:
            async with connection.execute(
                f"""
                SELECT
                    role, content, citations, citation_urls, grounded, created_at
                FROM conversation_messages
                {where}
                ORDER BY id DESC
                LIMIT ?
                """,
                params,
            ) as cursor:
                rows = await cursor.fetchall()
        messages = tuple(
            ConversationMessage(
                role=row["role"],
                content=row["content"],
                citations=_parse_citations(row["citations"]),
                citation_urls=_parse_citation_urls(row["citation_urls"]),
                grounded=bool(row["grounded"]),
                created_at=row["created_at"],
            )
            for row in reversed(rows)
        )
        return messages

    async def count(
        self,
        *,
        conversation_id: str | None = None,
    ) -> int:
        where = ""
        params: list[object] = []
        if conversation_id is not None:
            where = "WHERE conversation_id = ?"
            params.append(conversation_id)
        async with self._database.transaction(immediate=False) as connection:
            async with connection.execute(
                f"SELECT COUNT(*) AS total FROM conversation_messages {where}",
                params,
            ) as cursor:
                row = await cursor.fetchone()
        return int(row["total"]) if row is not None else 0

    async def append(
        self,
        *,
        role: str,
        content: str,
        citations: tuple[str, ...] = (),
        citation_urls: tuple[str | None, ...] = (),
        grounded: bool = False,
        conversation_id: str | None = None,
    ) -> None:
        if role not in {"user", "assistant"}:
            raise ValueError("conversation role must be user or assistant")
        if not content.strip():
            raise ValueError("conversation message must not be empty")
        citation_values = tuple(citation for citation in citations if citation)
        citation_url_values = tuple(
            url if isinstance(url, str) and url else None
            for url in citation_urls
        )
        async with self._database.transaction() as connection:
            await connection.execute(
                """
                INSERT INTO conversation_messages (
                    role, content, citations, citation_urls, grounded, conversation_id
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    role,
                    content,
                    json.dumps(citation_values, ensure_ascii=False),
                    json.dumps(citation_url_values, ensure_ascii=False),
                    int(grounded),
                    conversation_id,
                ),
            )

    async def delete_last_assistant(self) -> bool:
        async with self._database.transaction() as connection:
            async with connection.execute(
                """
                SELECT id
                FROM conversation_messages
                WHERE role = 'assistant'
                ORDER BY id DESC
                LIMIT 1
                """
            ) as cursor:
                row = await cursor.fetchone()
            if row is None:
                return False
            await connection.execute(
                "DELETE FROM conversation_messages WHERE id = ?",
                (row["id"],),
            )
            return True

    async def clear(self, *, conversation_id: str | None = None) -> None:
        if conversation_id is not None:
            async with self._database.transaction() as connection:
                await connection.execute(
                    "DELETE FROM conversation_messages WHERE conversation_id = ?",
                    (conversation_id,),
                )
            return
        async with self._database.transaction() as connection:
            await connection.execute("DELETE FROM conversation_messages")


def _parse_citations(value: str | None) -> tuple[str, ...]:
    if not value:
        return ()
    try:
        parsed = json.loads(value)
    except (TypeError, ValueError):
        return ()
    return tuple(
        str(item)
        for item in parsed
        if isinstance(item, str) and item
    )


def _parse_citation_urls(value: str | None) -> tuple[str | None, ...]:
    if not value:
        return ()
    try:
        parsed = json.loads(value)
    except (TypeError, ValueError):
        return ()
    return tuple(
        item if isinstance(item, str) and item else None
        for item in parsed
    )
