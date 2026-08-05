from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from enum import Enum
from uuid import uuid4

import aiosqlite

from voxstudio_core.persistence.database import Database


class DigitalHumanStatus(str, Enum):
    PENDING = "pending"
    BUILDING = "building"
    READY = "ready"
    FAILED = "failed"
    CANCELLED = "cancelled"


class DigitalHumanNotFoundError(LookupError):
    pass


class NoDefaultDigitalHumanError(LookupError):
    pass


@dataclass(frozen=True, slots=True)
class DigitalHuman:
    id: str
    name: str
    creation_status: DigitalHumanStatus
    created_at: datetime
    updated_at: datetime
    is_default: bool
    voice_provider_id: str | None = None
    avatar_provider_id: str | None = None
    voice_id: str | None = None
    avatar_id: str | None = None
    creation_progress: str | None = None
    error: str | None = None
    portrait_path: str | None = None
    recording_path: str | None = None
    remote_status: str | None = None


class DigitalHumanRepository:
    def __init__(self, database: Database) -> None:
        self._database = database

    async def create(
        self,
        *,
        name: str,
        portrait_path: str | None = None,
        recording_path: str | None = None,
        voice_provider_id: str | None = None,
        avatar_provider_id: str | None = None,
        created_at: datetime | None = None,
        digital_human_id: str | None = None,
    ) -> DigitalHuman:
        resolved_id = digital_human_id or str(uuid4())
        resolved_created_at = created_at or datetime.now(UTC)
        timestamp = _serialize_timestamp(resolved_created_at)
        async with self._database.transaction() as connection:
            has_default = await _any_default(connection)
            is_default = int(not has_default)
            await connection.execute(
                """
                INSERT INTO digital_humans (
                    id, name, creation_status, creation_progress,
                    created_at, updated_at, is_default, error,
                    portrait_path, recording_path,
                    voice_provider_id, avatar_provider_id, remote_status
                ) VALUES (?, ?, ?, NULL, ?, ?, ?, NULL, ?, ?, ?, ?, NULL)
                """,
                (
                    resolved_id,
                    name.strip(),
                    DigitalHumanStatus.PENDING.value,
                    timestamp,
                    timestamp,
                    is_default,
                    portrait_path,
                    recording_path,
                    voice_provider_id,
                    avatar_provider_id,
                ),
            )
            return await _load(connection, resolved_id)

    async def list(self, *, limit: int = 100, offset: int = 0) -> tuple[DigitalHuman, ...]:
        if limit < 1:
            raise ValueError("limit must be >= 1")
        if offset < 0:
            raise ValueError("offset must be >= 0")
        async with self._database.transaction(immediate=False) as connection:
            async with connection.execute(
                """
                SELECT * FROM digital_humans
                ORDER BY is_default DESC, updated_at DESC, id DESC
                LIMIT ? OFFSET ?
                """,
                (limit, offset),
            ) as cursor:
                rows = await cursor.fetchall()
        return tuple(_from_row(row) for row in rows)

    async def count(self) -> int:
        async with self._database.transaction(immediate=False) as connection:
            async with connection.execute(
                "SELECT COUNT(*) AS total FROM digital_humans"
            ) as cursor:
                row = await cursor.fetchone()
        return int(row["total"]) if row is not None else 0

    async def get(self, digital_human_id: str) -> DigitalHuman:
        async with self._database.transaction(immediate=False) as connection:
            return await _load(connection, digital_human_id)

    async def get_default(self) -> DigitalHuman | None:
        async with self._database.transaction(immediate=False) as connection:
            async with connection.execute(
                """
                SELECT * FROM digital_humans
                WHERE is_default = 1
                ORDER BY updated_at DESC, id DESC
                LIMIT 1
                """
            ) as cursor:
                row = await cursor.fetchone()
        return None if row is None else _from_row(row)

    async def set_default(self, digital_human_id: str) -> DigitalHuman:
        async with self._database.transaction() as connection:
            await _load(connection, digital_human_id)
            await connection.execute(
                "UPDATE digital_humans SET is_default = 0"
            )
            await connection.execute(
                "UPDATE digital_humans SET is_default = 1 WHERE id = ?",
                (digital_human_id,),
            )
            return await _load(connection, digital_human_id)

    async def update_status(
        self,
        digital_human_id: str,
        *,
        status: DigitalHumanStatus,
        progress: str | None = None,
        error: str | None = None,
        voice_id: str | None = None,
        avatar_id: str | None = None,
        remote_status: str | None = None,
        updated_at: datetime | None = None,
    ) -> DigitalHuman:
        timestamp = _serialize_timestamp(updated_at or datetime.now(UTC))
        async with self._database.transaction() as connection:
            cursor = await connection.execute(
                """
                UPDATE digital_humans
                SET creation_status = ?,
                    creation_progress = ?,
                    error = COALESCE(?, error),
                    voice_id = COALESCE(?, voice_id),
                    avatar_id = COALESCE(?, avatar_id),
                    remote_status = COALESCE(?, remote_status),
                    updated_at = ?
                WHERE id = ?
                """,
                (
                    status.value,
                    progress,
                    error,
                    voice_id,
                    avatar_id,
                    remote_status,
                    timestamp,
                    digital_human_id,
                ),
            )
            if cursor.rowcount != 1:
                raise DigitalHumanNotFoundError(digital_human_id)
            return await _load(connection, digital_human_id)

    async def rename(self, digital_human_id: str, *, name: str) -> DigitalHuman:
        if not name.strip():
            raise ValueError("name must not be empty")
        async with self._database.transaction() as connection:
            cursor = await connection.execute(
                """
                UPDATE digital_humans
                SET name = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    name.strip(),
                    _serialize_timestamp(datetime.now(UTC)),
                    digital_human_id,
                ),
            )
            if cursor.rowcount != 1:
                raise DigitalHumanNotFoundError(digital_human_id)
            return await _load(connection, digital_human_id)

    async def delete(self, digital_human_id: str) -> None:
        async with self._database.transaction() as connection:
            cursor = await connection.execute(
                "DELETE FROM digital_humans WHERE id = ?",
                (digital_human_id,),
            )
            if cursor.rowcount != 1:
                raise DigitalHumanNotFoundError(digital_human_id)


async def _any_default(connection: aiosqlite.Connection) -> bool:
    async with connection.execute(
        "SELECT 1 FROM digital_humans WHERE is_default = 1 LIMIT 1"
    ) as cursor:
        return await cursor.fetchone() is not None


async def _load(
    connection: aiosqlite.Connection,
    digital_human_id: str,
) -> DigitalHuman:
    async with connection.execute(
        "SELECT * FROM digital_humans WHERE id = ?",
        (digital_human_id,),
    ) as cursor:
        row = await cursor.fetchone()
    if row is None:
        raise DigitalHumanNotFoundError(digital_human_id)
    return _from_row(row)


def _from_row(row: aiosqlite.Row) -> DigitalHuman:
    return DigitalHuman(
        id=row["id"],
        name=row["name"],
        voice_provider_id=row["voice_provider_id"],
        avatar_provider_id=row["avatar_provider_id"],
        voice_id=row["voice_id"],
        avatar_id=row["avatar_id"],
        creation_status=DigitalHumanStatus(row["creation_status"]),
        creation_progress=row["creation_progress"],
        created_at=_deserialize_timestamp(row["created_at"]),
        updated_at=_deserialize_timestamp(row["updated_at"]),
        is_default=bool(row["is_default"]),
        error=row["error"],
        portrait_path=row["portrait_path"],
        recording_path=row["recording_path"],
        remote_status=row["remote_status"],
    )


def _serialize_timestamp(timestamp: datetime) -> str:
    if timestamp.tzinfo is None or timestamp.utcoffset() is None:
        raise ValueError("timestamps must include a timezone")
    return timestamp.astimezone(UTC).isoformat(timespec="microseconds")


def _deserialize_timestamp(timestamp: str) -> datetime:
    return datetime.fromisoformat(timestamp)