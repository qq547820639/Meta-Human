from pathlib import Path

import aiosqlite
import pytest

from voxstudio_core.persistence.database import Database


@pytest.mark.asyncio
async def test_memory_management_migration_is_backward_compatible(
    tmp_path: Path,
) -> None:
    """Upgrading a database that predates migration 015 must preserve legacy
    rows, backfill sources, and add the new management columns + ignore-rules
    table without breaking existing data.
    """
    path = tmp_path / "upgrade.sqlite3"
    async with aiosqlite.connect(path) as connection:
        await connection.execute(
            """
            CREATE TABLE schema_migrations (
                version INTEGER PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                applied_at TEXT NOT NULL
            )
            """
        )
        for version in range(1, 15):
            await connection.execute(
                "INSERT INTO schema_migrations (version, name, applied_at) "
                "VALUES (?, ?, '2026-01-01T00:00:00Z')",
                (version, f"{version:03d}_legacy.sql"),
            )
        # The pre-015 memory_entries schema (created by migration 011).
        await connection.execute(
            """
            CREATE TABLE memory_entries (
                id TEXT PRIMARY KEY NOT NULL CHECK (length(id) > 0),
                type TEXT NOT NULL DEFAULT 'user_fact',
                content TEXT NOT NULL CHECK (length(content) > 0),
                source_message_id TEXT,
                confidence REAL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                last_used_at TEXT,
                confirmed_by_user INTEGER NOT NULL DEFAULT 0
                    CHECK (confirmed_by_user IN (0, 1)),
                sensitive INTEGER NOT NULL DEFAULT 0
                    CHECK (sensitive IN (0, 1)),
                expires_at TEXT,
                conflict_group TEXT
            )
            """
        )
        await connection.execute(
            "CREATE INDEX memory_entries_type ON memory_entries (type)"
        )
        await connection.execute(
            "CREATE INDEX memory_entries_created_at "
            "ON memory_entries (created_at DESC)"
        )
        await connection.execute(
            "INSERT INTO memory_entries (id, type, content, created_at, updated_at) "
            "VALUES ('legacy-1', 'explicit_request', '请记住我的生日', "
            "'2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')"
        )
        await connection.execute(
            "INSERT INTO memory_entries (id, type, content, created_at, updated_at) "
            "VALUES ('legacy-2', 'preference', '用户喜欢咖啡', "
            "'2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')"
        )
        await connection.commit()

    database = Database(path)
    await database.migrate()

    async with aiosqlite.connect(path) as connection:
        connection.row_factory = aiosqlite.Row
        async with connection.execute(
            "SELECT id, source, scope, pinned, disabled FROM memory_entries "
            "ORDER BY id"
        ) as cursor:
            rows = await cursor.fetchall()
        result = {
            (row["id"], row["source"], row["scope"], row["pinned"], row["disabled"])
            for row in rows
        }
        # Legacy rows survive; explicit_request backfilled to user source.
        assert ("legacy-1", "user", "global", 0, 0) in result
        assert ("legacy-2", "system", "global", 0, 0) in result

        # The new ignore-rules table is present and usable.
        await connection.execute(
            "INSERT INTO memory_ignore_rules (id, type, scope, created_at) "
            "VALUES ('r1', 'preference', 'global', '2026-01-01T00:00:00Z')"
        )
        await connection.execute(
            "INSERT INTO memory_ignore_rules (id, type, scope, scope_id, created_at) "
            "VALUES ('r2', 'goal', 'digital_human', 'dh-1', "
            "'2026-01-01T00:00:00Z')"
        )
        async with connection.execute(
            "SELECT COUNT(*) AS c FROM memory_ignore_rules"
        ) as cursor:
            row = await cursor.fetchone()
        assert row["c"] == 2

    await database.close()