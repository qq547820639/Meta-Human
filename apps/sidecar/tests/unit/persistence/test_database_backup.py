from pathlib import Path

import aiosqlite
import pytest

from voxstudio_core.persistence.database import Database, _migration_files


@pytest.mark.asyncio
async def test_migrate_does_not_back_up_a_fresh_empty_database(
    tmp_path: Path,
) -> None:
    path = tmp_path / "fresh.sqlite3"
    database = Database(path)
    await database.connect()
    await database.migrate()

    assert list(tmp_path.glob("*.bak.*")) == []

    await database.close()


@pytest.mark.asyncio
async def test_migrate_does_not_back_up_when_everything_is_applied(
    tmp_path: Path,
) -> None:
    path = tmp_path / "idempotent.sqlite3"
    database = Database(path)
    await database.connect()
    await database.migrate()
    await database.migrate()

    # Re-running migrate with no pending migrations must not create a backup.
    assert list(tmp_path.glob("*.bak.*")) == []

    await database.close()


@pytest.mark.asyncio
async def test_migrate_backs_up_database_before_applying_pending_versions(
    tmp_path: Path,
) -> None:
    path = tmp_path / "prepared.sqlite3"
    # Build a database that has only migration 001 applied and holds real data,
    # simulating an older install that still has pending migrations on upgrade.
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
        await connection.execute(
            "INSERT INTO schema_migrations (version, name, applied_at) "
            "VALUES (1, '001_readiness.sql', '2026-01-01T00:00:00Z')"
        )
        await connection.execute(
            "CREATE TABLE _vox_backup_marker (id INTEGER PRIMARY KEY, value TEXT)"
        )
        await connection.execute(
            "INSERT INTO _vox_backup_marker (value) VALUES ('keep-me')"
        )
        await connection.commit()

    database = Database(path)
    await database.migrate()

    backups = list(tmp_path.glob("*.bak.*"))
    assert len(backups) == 1
    latest_version = _migration_files()[-1][0]
    assert backups[0].name == f"prepared.sqlite3.bak.{latest_version}"

    # The snapshot predates the pending migrations and must still contain the
    # marker row written before the upgrade.
    async with aiosqlite.connect(backups[0]) as connection:
        async with connection.execute(
            "SELECT value FROM _vox_backup_marker"
        ) as cursor:
            row = await cursor.fetchone()
        assert row is not None
        assert row[0] == "keep-me"

    await database.close()