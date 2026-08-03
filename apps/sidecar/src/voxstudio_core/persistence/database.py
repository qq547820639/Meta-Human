from __future__ import annotations

import asyncio
import sqlite3
from collections.abc import AsyncIterator, Iterator
from contextlib import asynccontextmanager
from pathlib import Path

import aiosqlite


class Database:
    def __init__(self, path: Path | str) -> None:
        self.path = Path(path)
        self._connection: aiosqlite.Connection | None = None
        self._lock = asyncio.Lock()

    async def connect(self) -> None:
        async with self._lock:
            if self._connection is not None:
                return

            self.path.parent.mkdir(parents=True, exist_ok=True)
            connection = await aiosqlite.connect(self.path)
            connection.row_factory = aiosqlite.Row
            await connection.execute("PRAGMA foreign_keys = ON")
            await connection.execute("PRAGMA busy_timeout = 5000")
            await connection.commit()
            self._connection = connection

    async def close(self) -> None:
        async with self._lock:
            if self._connection is None:
                return

            await self._connection.close()
            self._connection = None

    async def migrate(self) -> None:
        await self.connect()
        async with self.transaction() as connection:
            await connection.execute(
                """
                CREATE TABLE IF NOT EXISTS schema_migrations (
                    version INTEGER PRIMARY KEY,
                    name TEXT NOT NULL UNIQUE,
                    applied_at TEXT NOT NULL
                )
                """
            )

        migrations = _migration_files()
        for version, migration_path in migrations:
            async with self.transaction() as connection:
                async with connection.execute(
                    "SELECT 1 FROM schema_migrations WHERE version = ?",
                    (version,),
                ) as cursor:
                    already_applied = await cursor.fetchone()
                if already_applied is not None:
                    continue

                script = migration_path.read_text(encoding="utf-8")
                for statement in _sql_statements(script):
                    await connection.execute(statement)
                await connection.execute(
                    """
                    INSERT INTO schema_migrations (version, name, applied_at)
                    VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                    """,
                    (version, migration_path.name),
                )

    async def applied_migration_versions(self) -> tuple[int, ...]:
        async with self.transaction(immediate=False) as connection:
            async with connection.execute(
                "SELECT version FROM schema_migrations ORDER BY version"
            ) as cursor:
                rows = await cursor.fetchall()
        return tuple(row["version"] for row in rows)

    @asynccontextmanager
    async def transaction(
        self,
        *,
        immediate: bool = True,
    ) -> AsyncIterator[aiosqlite.Connection]:
        await self.connect()
        async with self._lock:
            connection = self._connected_connection
            began = False
            try:
                await connection.execute("BEGIN IMMEDIATE" if immediate else "BEGIN")
                began = True
                yield connection
            except BaseException:
                if began:
                    await connection.rollback()
                raise
            else:
                await connection.commit()

    @property
    def _connected_connection(self) -> aiosqlite.Connection:
        if self._connection is None:
            raise RuntimeError("database is not connected")
        return self._connection


def _migration_files() -> tuple[tuple[int, Path], ...]:
    migration_directory = Path(__file__).with_name("migrations")
    migrations: list[tuple[int, Path]] = []
    seen_versions: set[int] = set()
    for migration_path in migration_directory.glob("[0-9][0-9][0-9]_*.sql"):
        version = int(migration_path.name.split("_", maxsplit=1)[0])
        if version in seen_versions:
            raise RuntimeError(f"duplicate migration version: {version}")
        seen_versions.add(version)
        migrations.append((version, migration_path))
    return tuple(sorted(migrations))


def _sql_statements(script: str) -> Iterator[str]:
    pending = ""
    for line in script.splitlines(keepends=True):
        pending += line
        if sqlite3.complete_statement(pending):
            statement = pending.strip()
            if statement:
                yield statement
            pending = ""
    if pending.strip():
        raise ValueError("migration contains an incomplete SQL statement")
