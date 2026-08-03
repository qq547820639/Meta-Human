from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import uuid4

import aiosqlite

from voxstudio_core.persistence.database import Database


class MemoryEntryNotFoundError(LookupError):
    pass


@dataclass(frozen=True, slots=True)
class MemoryEntry:
    id: str
    type: str
    content: str
    source_message_id: str | None
    confidence: float | None
    created_at: str
    updated_at: str
    last_used_at: str | None
    confirmed_by_user: bool
    sensitive: bool
    expires_at: str | None
    conflict_group: str | None


class MemoryEntryRepository:
    def __init__(self, database: Database) -> None:
        self._database = database

    async def create(
        self,
        *,
        type: str,
        content: str,
        source_message_id: str | None = None,
        confidence: float | None = None,
        expires_at: str | None = None,
        conflict_group: str | None = None,
        sensitive: bool = False,
        confirmed_by_user: bool = False,
        entry_id: str | None = None,
    ) -> MemoryEntry:
        if not content.strip():
            raise ValueError("memory content must not be empty")
        resolved_id = entry_id or str(uuid4())
        timestamp = _serialize_timestamp(datetime.now(UTC))
        async with self._database.transaction() as connection:
            await connection.execute(
                """
                INSERT INTO memory_entries (
                    id, type, content, source_message_id, confidence,
                    created_at, updated_at, last_used_at,
                    confirmed_by_user, sensitive, expires_at, conflict_group
                ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)
                """,
                (
                    resolved_id,
                    type,
                    content.strip(),
                    source_message_id,
                    confidence,
                    timestamp,
                    timestamp,
                    int(confirmed_by_user),
                    int(sensitive),
                    expires_at,
                    conflict_group,
                ),
            )
            return await _load(connection, resolved_id)

    async def list(
        self,
        *,
        type: str | None = None,
    ) -> tuple[MemoryEntry, ...]:
        if type is None:
            async with self._database.transaction(immediate=False) as connection:
                async with connection.execute(
                    """
                    SELECT * FROM memory_entries
                    ORDER BY created_at DESC, id DESC
                    """
                ) as cursor:
                    rows = await cursor.fetchall()
        else:
            async with self._database.transaction(immediate=False) as connection:
                async with connection.execute(
                    """
                    SELECT * FROM memory_entries
                    WHERE type = ?
                    ORDER BY created_at DESC, id DESC
                    """,
                    (type,),
                ) as cursor:
                    rows = await cursor.fetchall()
        return tuple(_from_row(row) for row in rows)

    async def get(self, entry_id: str) -> MemoryEntry:
        async with self._database.transaction(immediate=False) as connection:
            return await _load(connection, entry_id)

    async def update_content(
        self,
        entry_id: str,
        *,
        content: str,
    ) -> MemoryEntry:
        if not content.strip():
            raise ValueError("memory content must not be empty")
        async with self._database.transaction() as connection:
            cursor = await connection.execute(
                """
                UPDATE memory_entries
                SET content = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    content.strip(),
                    _serialize_timestamp(datetime.now(UTC)),
                    entry_id,
                ),
            )
            if cursor.rowcount != 1:
                raise MemoryEntryNotFoundError(entry_id)
            return await _load(connection, entry_id)

    async def set_confirmed(
        self,
        entry_id: str,
        *,
        confirmed: bool = True,
    ) -> MemoryEntry:
        async with self._database.transaction() as connection:
            cursor = await connection.execute(
                """
                UPDATE memory_entries
                SET confirmed_by_user = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    int(confirmed),
                    _serialize_timestamp(datetime.now(UTC)),
                    entry_id,
                ),
            )
            if cursor.rowcount != 1:
                raise MemoryEntryNotFoundError(entry_id)
            return await _load(connection, entry_id)

    async def set_sensitive(
        self,
        entry_id: str,
        *,
        sensitive: bool = True,
    ) -> MemoryEntry:
        async with self._database.transaction() as connection:
            cursor = await connection.execute(
                """
                UPDATE memory_entries
                SET sensitive = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    int(sensitive),
                    _serialize_timestamp(datetime.now(UTC)),
                    entry_id,
                ),
            )
            if cursor.rowcount != 1:
                raise MemoryEntryNotFoundError(entry_id)
            return await _load(connection, entry_id)

    async def delete(self, entry_id: str) -> None:
        async with self._database.transaction() as connection:
            cursor = await connection.execute(
                "DELETE FROM memory_entries WHERE id = ?",
                (entry_id,),
            )
            if cursor.rowcount != 1:
                raise MemoryEntryNotFoundError(entry_id)

    async def clear_all(self) -> None:
        async with self._database.transaction() as connection:
            await connection.execute("DELETE FROM memory_entries")

    async def count(self) -> int:
        async with self._database.transaction(immediate=False) as connection:
            async with connection.execute(
                "SELECT COUNT(*) AS total FROM memory_entries"
            ) as cursor:
                row = await cursor.fetchone()
        return int(row["total"]) if row is not None else 0

    async def search(
        self,
        *,
        query: str,
    ) -> tuple[MemoryEntry, ...]:
        term = f"%{query.strip()}%"
        async with self._database.transaction(immediate=False) as connection:
            async with connection.execute(
                """
                SELECT * FROM memory_entries
                WHERE content LIKE ?
                ORDER BY created_at DESC, id DESC
                """,
                (term,),
            ) as cursor:
                rows = await cursor.fetchall()
        return tuple(_from_row(row) for row in rows)


async def _load(
    connection: aiosqlite.Connection,
    entry_id: str,
) -> MemoryEntry:
    async with connection.execute(
        "SELECT * FROM memory_entries WHERE id = ?",
        (entry_id,),
    ) as cursor:
        row = await cursor.fetchone()
    if row is None:
        raise MemoryEntryNotFoundError(entry_id)
    return _from_row(row)


def _from_row(row: aiosqlite.Row) -> MemoryEntry:
    return MemoryEntry(
        id=row["id"],
        type=row["type"],
        content=row["content"],
        source_message_id=row["source_message_id"],
        confidence=row["confidence"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        last_used_at=row["last_used_at"],
        confirmed_by_user=bool(row["confirmed_by_user"]),
        sensitive=bool(row["sensitive"]),
        expires_at=row["expires_at"],
        conflict_group=row["conflict_group"],
    )


def _serialize_timestamp(timestamp: datetime) -> str:
    if timestamp.tzinfo is None or timestamp.utcoffset() is None:
        raise ValueError("timestamps must include a timezone")
    return timestamp.astimezone(UTC).isoformat(timespec="microseconds")