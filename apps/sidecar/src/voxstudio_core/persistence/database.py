from __future__ import annotations

import asyncio
import logging
import shutil
import sqlite3
from collections.abc import AsyncIterator, Iterator
from contextlib import asynccontextmanager
from pathlib import Path

import aiosqlite


logger = logging.getLogger(__name__)


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
        applied = await self.applied_migration_versions()
        await self._backup_before_migrations(applied)
        for version, migration_path in migrations:
            if version in applied:
                continue
            async with self.transaction() as connection:
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

    async def _backup_before_migrations(self, applied: tuple[int, ...]) -> None:
        """Copy the current database to a `<name>.bak.<target_version>` before
        applying any pending migrations so a failed upgrade can be rolled back.

        The copy is made only when there are pending migrations and the database
        already contains real app tables (a fresh install has only the
        `schema_migrations` bookkeeping table, so there is nothing worth backing
        up). No write transaction is open at this point, so the main file is a
        consistent snapshot (the database uses the default rollback journal, not
        WAL). Restoral is manual: stop the app, replace the database file with
        the `.bak.<version>` snapshot, then start again.
        """
        pending = [
            version
            for version, _ in _migration_files()
            if version not in applied
        ]
        if not pending:
            return
        async with self.transaction(immediate=False) as connection:
            async with connection.execute(
                """
                SELECT 1 FROM sqlite_master
                WHERE type = 'table' AND name != 'schema_migrations'
                LIMIT 1
                """
            ) as cursor:
                has_app_tables = await cursor.fetchone()
        if has_app_tables is None:
            return
        target_version = pending[-1]
        backup_path = self.path.with_name(f"{self.path.name}.bak.{target_version}")
        shutil.copy2(self.path, backup_path)
        logger.info(
            "Backed up database before migration to %s",
            backup_path,
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
