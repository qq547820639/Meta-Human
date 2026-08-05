from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import uuid4

import aiosqlite

from voxstudio_core.persistence.database import Database


class MemoryEntryNotFoundError(LookupError):
    pass


MEMORY_SOURCE_USER = "user"  # user explicitly asked to remember
MEMORY_SOURCE_SYSTEM = "system"  # automatically summarized by the system

MEMORY_SOURCES = (MEMORY_SOURCE_USER, MEMORY_SOURCE_SYSTEM)

MEMORY_SCOPE_GLOBAL = "global"
MEMORY_SCOPE_DIGITAL_HUMAN = "digital_human"
MEMORY_SCOPE_CONVERSATION = "conversation"

MEMORY_SCOPES = (
    MEMORY_SCOPE_GLOBAL,
    MEMORY_SCOPE_DIGITAL_HUMAN,
    MEMORY_SCOPE_CONVERSATION,
)


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
    source: str = MEMORY_SOURCE_SYSTEM
    scope: str = MEMORY_SCOPE_GLOBAL
    scope_id: str | None = None
    pinned: bool = False
    disabled: bool = False


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
        source: str = MEMORY_SOURCE_SYSTEM,
        scope: str = MEMORY_SCOPE_GLOBAL,
        scope_id: str | None = None,
        pinned: bool = False,
        disabled: bool = False,
    ) -> MemoryEntry:
        if not content.strip():
            raise ValueError("memory content must not be empty")
        if source not in MEMORY_SOURCES:
            raise ValueError(f"unknown memory source: {source}")
        if scope not in MEMORY_SCOPES:
            raise ValueError(f"unknown memory scope: {scope}")
        if scope == MEMORY_SCOPE_GLOBAL and scope_id is not None:
            raise ValueError("global memory scope must not carry a scope_id")
        if scope != MEMORY_SCOPE_GLOBAL and not (scope_id or "").strip():
            raise ValueError(f"memory scope {scope} requires a scope_id")
        resolved_id = entry_id or str(uuid4())
        timestamp = _serialize_timestamp(datetime.now(UTC))
        async with self._database.transaction() as connection:
            await connection.execute(
                """
                INSERT INTO memory_entries (
                    id, type, content, source_message_id, confidence,
                    created_at, updated_at, last_used_at,
                    confirmed_by_user, sensitive, expires_at, conflict_group,
                    source, scope, scope_id, pinned, disabled
                ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                    source,
                    scope,
                    scope_id,
                    int(pinned),
                    int(disabled),
                ),
            )
            return await _load(connection, resolved_id)

    async def list(
        self,
        *,
        type: str | None = None,
        source: str | None = None,
        scope: str | None = None,
        scope_id: str | None = None,
        include_disabled: bool = True,
    ) -> tuple[MemoryEntry, ...]:
        clauses: list[str] = []
        params: list[object] = []
        if type is not None:
            clauses.append("type = ?")
            params.append(type)
        if source is not None:
            clauses.append("source = ?")
            params.append(source)
        if scope is not None:
            clauses.append("scope = ?")
            params.append(scope)
        if scope_id is not None:
            clauses.append("scope_id = ?")
            params.append(scope_id)
        if not include_disabled:
            clauses.append("disabled = 0")
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        async with self._database.transaction(immediate=False) as connection:
            async with connection.execute(
                f"""
                SELECT * FROM memory_entries
                {where}
                ORDER BY pinned DESC, created_at DESC, id DESC
                """,
                tuple(params),
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

    async def set_pinned(
        self,
        entry_id: str,
        *,
        pinned: bool = True,
    ) -> MemoryEntry:
        async with self._database.transaction() as connection:
            cursor = await connection.execute(
                """
                UPDATE memory_entries
                SET pinned = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    int(pinned),
                    _serialize_timestamp(datetime.now(UTC)),
                    entry_id,
                ),
            )
            if cursor.rowcount != 1:
                raise MemoryEntryNotFoundError(entry_id)
            return await _load(connection, entry_id)

    async def set_disabled(
        self,
        entry_id: str,
        *,
        disabled: bool = True,
    ) -> MemoryEntry:
        async with self._database.transaction() as connection:
            cursor = await connection.execute(
                """
                UPDATE memory_entries
                SET disabled = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    int(disabled),
                    _serialize_timestamp(datetime.now(UTC)),
                    entry_id,
                ),
            )
            if cursor.rowcount != 1:
                raise MemoryEntryNotFoundError(entry_id)
            return await _load(connection, entry_id)

    async def exists(self, entry_id: str) -> bool:
        async with self._database.transaction(immediate=False) as connection:
            async with connection.execute(
                "SELECT 1 FROM memory_entries WHERE id = ?",
                (entry_id,),
            ) as cursor:
                row = await cursor.fetchone()
        return row is not None

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


@dataclass(frozen=True, slots=True)
class MemoryIgnoreRule:
    id: str
    type: str
    scope: str
    scope_id: str | None
    created_at: str


class MemoryIgnoreRuleNotFoundError(LookupError):
    pass


class MemoryIgnoreRuleRepository:
    """Stores "不再记住此类信息" rules keyed by (type, scope, scope_id)."""

    def __init__(self, database: Database) -> None:
        self._database = database

    async def create(
        self,
        *,
        type: str,
        scope: str = MEMORY_SCOPE_GLOBAL,
        scope_id: str | None = None,
    ) -> MemoryIgnoreRule:
        if not (type or "").strip():
            raise ValueError("ignore rule type must not be empty")
        if scope not in MEMORY_SCOPES:
            raise ValueError(f"unknown memory scope: {scope}")
        if scope == MEMORY_SCOPE_GLOBAL and scope_id is not None:
            raise ValueError("global scope must not carry a scope_id")
        if scope != MEMORY_SCOPE_GLOBAL and not (scope_id or "").strip():
            raise ValueError(f"scope {scope} requires a scope_id")
        resolved_id = str(uuid4())
        timestamp = _serialize_timestamp(datetime.now(UTC))
        existing = await self.find(type=type, scope=scope, scope_id=scope_id)
        if existing is not None:
            return existing
        async with self._database.transaction() as connection:
            await connection.execute(
                """
                INSERT INTO memory_ignore_rules (id, type, scope, scope_id, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (resolved_id, type.strip(), scope, scope_id, timestamp),
            )
        return MemoryIgnoreRule(
            id=resolved_id,
            type=type.strip(),
            scope=scope,
            scope_id=scope_id,
            created_at=timestamp,
        )

    async def find(
        self,
        *,
        type: str,
        scope: str = MEMORY_SCOPE_GLOBAL,
        scope_id: str | None = None,
    ) -> MemoryIgnoreRule | None:
        async with self._database.transaction(immediate=False) as connection:
            async with connection.execute(
                """
                SELECT * FROM memory_ignore_rules
                WHERE type = ? AND scope = ? AND scope_id IS ?
                """,
                (type, scope, scope_id),
            ) as cursor:
                row = await cursor.fetchone()
        return _rule_from_row(row) if row is not None else None

    async def list(
        self,
        *,
        scope: str | None = None,
        scope_id: str | None = None,
    ) -> tuple[MemoryIgnoreRule, ...]:
        clauses: list[str] = []
        params: list[object] = []
        if scope is not None:
            clauses.append("scope = ?")
            params.append(scope)
        if scope_id is not None:
            clauses.append("scope_id = ?")
            params.append(scope_id)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        async with self._database.transaction(immediate=False) as connection:
            async with connection.execute(
                f"""
                SELECT * FROM memory_ignore_rules
                {where}
                ORDER BY created_at DESC, id DESC
                """,
                tuple(params),
            ) as cursor:
                rows = await cursor.fetchall()
        return tuple(_rule_from_row(row) for row in rows)

    async def delete(self, rule_id: str) -> None:
        async with self._database.transaction() as connection:
            cursor = await connection.execute(
                "DELETE FROM memory_ignore_rules WHERE id = ?",
                (rule_id,),
            )
            if cursor.rowcount != 1:
                raise MemoryIgnoreRuleNotFoundError(rule_id)


def _rule_from_row(row: aiosqlite.Row) -> MemoryIgnoreRule:
    return MemoryIgnoreRule(
        id=row["id"],
        type=row["type"],
        scope=row["scope"],
        scope_id=row["scope_id"],
        created_at=row["created_at"],
    )


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
        source=row["source"],
        scope=row["scope"],
        scope_id=row["scope_id"],
        pinned=bool(row["pinned"]),
        disabled=bool(row["disabled"]),
    )


def _serialize_timestamp(timestamp: datetime) -> str:
    if timestamp.tzinfo is None or timestamp.utcoffset() is None:
        raise ValueError("timestamps must include a timezone")
    return timestamp.astimezone(UTC).isoformat(timespec="microseconds")
