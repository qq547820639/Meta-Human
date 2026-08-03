from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import uuid4

import aiosqlite

from voxstudio_core.persistence.database import Database

DEFAULT_TITLE = "新对话"


@dataclass(frozen=True, slots=True)
class Conversation:
    id: str
    title: str
    avatar_id: str | None
    created_at: str
    updated_at: str
    last_message_at: str | None
    archived: bool
    deleted: bool
    summary: str | None


class ConversationNotFoundError(LookupError):
    pass


class ConversationRepository:
    def __init__(self, database: Database) -> None:
        self._database = database

    async def create(
        self,
        *,
        title: str | None = None,
        avatar_id: str | None = None,
        conversation_id: str | None = None,
    ) -> Conversation:
        resolved_id = conversation_id or str(uuid4())
        timestamp = _serialize_timestamp(datetime.now(UTC))
        async with self._database.transaction() as connection:
            await connection.execute(
                """
                INSERT INTO conversations (
                    id, title, avatar_id, created_at, updated_at,
                    last_message_at, archived, deleted, summary
                ) VALUES (?, ?, ?, ?, ?, NULL, 0, 0, NULL)
                """,
                (
                    resolved_id,
                    (title.strip() if title and title.strip() else DEFAULT_TITLE),
                    avatar_id,
                    timestamp,
                    timestamp,
                ),
            )
            return await _load(connection, resolved_id)

    async def list(
        self,
        *,
        limit: int = 50,
        offset: int = 0,
        include_archived: bool = True,
    ) -> tuple[Conversation, ...]:
        clauses = ["deleted = 0"]
        params: list[object] = []
        if not include_archived:
            clauses.append("archived = 0")
        where = " AND ".join(clauses)
        params.extend([limit, offset])
        async with self._database.transaction(immediate=False) as connection:
            async with connection.execute(
                f"""
                SELECT * FROM conversations
                WHERE {where}
                ORDER BY updated_at DESC, id DESC
                LIMIT ? OFFSET ?
                """,
                params,
            ) as cursor:
                rows = await cursor.fetchall()
        return tuple(_from_row(row) for row in rows)

    async def get(self, conversation_id: str) -> Conversation:
        async with self._database.transaction(immediate=False) as connection:
            return await _load(connection, conversation_id)

    async def rename(self, conversation_id: str, *, title: str) -> Conversation:
        if not title.strip():
            raise ValueError("title must not be empty")
        async with self._database.transaction() as connection:
            cursor = await connection.execute(
                """
                UPDATE conversations
                SET title = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    title.strip(),
                    _serialize_timestamp(datetime.now(UTC)),
                    conversation_id,
                ),
            )
            if cursor.rowcount != 1:
                raise ConversationNotFoundError(conversation_id)
            return await _load(connection, conversation_id)

    async def delete(self, conversation_id: str) -> None:
        async with self._database.transaction() as connection:
            await _load(connection, conversation_id)
            await connection.execute(
                """
                UPDATE conversations
                SET deleted = 1, updated_at = ?
                WHERE id = ?
                """,
                (
                    _serialize_timestamp(datetime.now(UTC)),
                    conversation_id,
                ),
            )

    async def archive(
        self,
        conversation_id: str,
        *,
        archived: bool = True,
    ) -> Conversation:
        async with self._database.transaction() as connection:
            cursor = await connection.execute(
                """
                UPDATE conversations
                SET archived = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    int(archived),
                    _serialize_timestamp(datetime.now(UTC)),
                    conversation_id,
                ),
            )
            if cursor.rowcount != 1:
                raise ConversationNotFoundError(conversation_id)
            return await _load(connection, conversation_id)

    async def clear(self, conversation_id: str) -> None:
        async with self._database.transaction() as connection:
            await _load(connection, conversation_id)
            await connection.execute(
                "DELETE FROM conversation_messages WHERE conversation_id = ?",
                (conversation_id,),
            )
            await connection.execute(
                """
                UPDATE conversations
                SET last_message_at = NULL, updated_at = ?
                WHERE id = ?
                """,
                (
                    _serialize_timestamp(datetime.now(UTC)),
                    conversation_id,
                ),
            )

    async def search(
        self,
        *,
        query: str,
        limit: int = 50,
    ) -> tuple[Conversation, ...]:
        term = f"%{query.strip()}%"
        async with self._database.transaction(immediate=False) as connection:
            async with connection.execute(
                """
                SELECT * FROM conversations
                WHERE deleted = 0
                  AND (
                      title LIKE ? OR
                      summary LIKE ? OR
                      id IN (
                          SELECT DISTINCT conversation_id
                          FROM conversation_messages
                          WHERE conversation_id IS NOT NULL
                            AND content LIKE ?
                      )
                  )
                ORDER BY updated_at DESC, id DESC
                LIMIT ?
                """,
                (term, term, term, limit),
            ) as cursor:
                rows = await cursor.fetchall()
        return tuple(_from_row(row) for row in rows)

    async def count(self, *, include_deleted: bool = False) -> int:
        where = "" if include_deleted else "WHERE deleted = 0"
        async with self._database.transaction(immediate=False) as connection:
            async with connection.execute(
                f"SELECT COUNT(*) AS total FROM conversations {where}"
            ) as cursor:
                row = await cursor.fetchone()
        return int(row["total"]) if row is not None else 0

    async def set_last_message(self, conversation_id: str) -> None:
        timestamp = _serialize_timestamp(datetime.now(UTC))
        async with self._database.transaction() as connection:
            cursor = await connection.execute(
                """
                UPDATE conversations
                SET last_message_at = ?, updated_at = ?
                WHERE id = ?
                """,
                (timestamp, timestamp, conversation_id),
            )
            if cursor.rowcount != 1:
                raise ConversationNotFoundError(conversation_id)


async def _load(
    connection: aiosqlite.Connection,
    conversation_id: str,
) -> Conversation:
    async with connection.execute(
        "SELECT * FROM conversations WHERE id = ?",
        (conversation_id,),
    ) as cursor:
        row = await cursor.fetchone()
    if row is None:
        raise ConversationNotFoundError(conversation_id)
    return _from_row(row)


def _from_row(row: aiosqlite.Row) -> Conversation:
    return Conversation(
        id=row["id"],
        title=row["title"],
        avatar_id=row["avatar_id"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        last_message_at=row["last_message_at"],
        archived=bool(row["archived"]),
        deleted=bool(row["deleted"]),
        summary=row["summary"],
    )


def _serialize_timestamp(timestamp: datetime) -> str:
    if timestamp.tzinfo is None or timestamp.utcoffset() is None:
        raise ValueError("timestamps must include a timezone")
    return timestamp.astimezone(UTC).isoformat(timespec="microseconds")