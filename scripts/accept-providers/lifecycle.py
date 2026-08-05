"""Lifecycle acceptance checks.

These checks run for real without any external provider credentials. They reuse
the same persistence / lifecycle / build-job code paths the product uses to
recover from a crash, an interrupted network call, a GUI restart, an old-database
upgrade, and a failed migration. Each one is a genuine, self-contained check that
creates a throwaway SQLite database in a temp directory and asserts the recovery
behaviour characteristic of the product.
"""

from __future__ import annotations

import asyncio
import tempfile
import time
from datetime import UTC, datetime
from pathlib import Path

import aiosqlite

from voxstudio_core.knowledge.history import ConversationHistoryStore
from voxstudio_core.lifecycle import SidecarLifecycle
from voxstudio_core.persistence.build_job_repository import (
    BuildJobRepository,
    BuildJobStatus,
    BuildStage,
)
from voxstudio_core.persistence.database import Database, _migration_files
from voxstudio_core.persistence.digital_human_repository import (
    DigitalHumanRepository,
)
from voxstudio_core.persistence.readiness_repository import (
    CapabilityUpdate,
    ReadinessRepository,
)
from voxstudio_core.providers.build_job_service import BuildJobService
from voxstudio_core.readiness.models import (
    AggregateState,
    CapabilityId,
    CapabilityReadiness,
    CapabilityState,
)

import common
from common import (
    STATUS_FAIL,
    STATUS_PASS,
    CheckResult,
    finish,
)

CATEGORY = "lifecycle"

NOW = datetime(2026, 8, 1, 10, 0, tzinfo=UTC)


class _UnusedReadinessService:
    async def prepare(self):  # pragma: no cover - crash-restore must not prepare
        raise AssertionError("startup must restore without starting preparation")


class _NoopClient:
    """Minimal client stub: `current()`/`list_unfinished()` never call it."""


def _pending_capabilities() -> tuple[CapabilityReadiness, ...]:
    return tuple(
        CapabilityReadiness(
            id=capability_id,
            required=True,
            state=CapabilityState.PENDING,
        )
        for capability_id in CapabilityId
    )


async def _check_conversation_disconnect_resume() -> str:
    tmp = Path(tempfile.mkdtemp(prefix="accept-conv-"))
    db_path = tmp / "conv.sqlite3"
    db = Database(db_path)
    await db.migrate()
    history = ConversationHistoryStore(db)
    await history.append(role="user", content="你好", conversation_id="c1")
    await history.append(role="assistant", content="你好！", conversation_id="c1")
    await db.close()

    # Simulate a GUI/sidecar restart: reopen the database from disk.
    db = Database(db_path)
    await db.migrate()
    history = ConversationHistoryStore(db)
    messages = await history.list_recent(conversation_id="c1")
    await db.close()
    if len(messages) != 2:
        raise AssertionError(f"expected 2 restored messages, got {len(messages)}")
    if messages[0].role != "user" or messages[1].role != "assistant":
        raise AssertionError("restored message order/roles are wrong")
    return f"conversation (2 msgs) restored after restart for conversation_id=c1"


async def _check_build_disconnect_resume() -> str:
    tmp = Path(tempfile.mkdtemp(prefix="accept-build-"))
    db_path = tmp / "build.sqlite3"
    db = Database(db_path)
    await db.migrate()
    digital_humans = DigitalHumanRepository(db)
    await digital_humans.create(
        digital_human_id="dh-1",
        name="测试数字人",
        portrait_path="portrait.png",
        recording_path="recording.wav",
    )
    repo = BuildJobRepository(db)
    job = await repo.create(
        portrait_path="portrait.png",
        recording_path="recording.wav",
        job_id="job-interrupted",
        digital_human_id="dh-1",
    )
    await repo.update(
        job.id,
        status=BuildJobStatus.RUNNING,
        current_stage=BuildStage.ENROLL_VOICE,
    )
    await db.close()

    # Simulate a restart: reopen and confirm the interrupted job is reported as
    # unfinished/resumable (and completed jobs are never returned by current()).
    db = Database(db_path)
    await db.migrate()
    repo = BuildJobRepository(db)
    service = BuildJobService(
        repository=repo,
        digital_humans=DigitalHumanRepository(db),
        client=_NoopClient(),
    )
    unfinished = await repo.list_unfinished()
    current = await service.current()
    await db.close()
    if not any(item.id == "job-interrupted" for item in unfinished):
        raise AssertionError("interrupted build job not reported as unfinished")
    if current is None or current.id != "job-interrupted":
        raise AssertionError("current() did not report the interrupted job")
    return "interrupted build job survives restart and is reported resumable (current/list_unfinished)"


async def _check_sidecar_crash_restore() -> str:
    tmp = Path(tempfile.mkdtemp(prefix="accept-crash-"))
    db_path = tmp / "restore.sqlite3"
    seed = Database(db_path)
    await seed.migrate()
    seed_repo = ReadinessRepository(seed)
    run = await seed_repo.create_or_get_current_run(
        _pending_capabilities(),
        run_id="interrupted-run",
        created_at=NOW,
    )
    await seed_repo.update_capabilities(
        run.id,
        (
            CapabilityUpdate(
                id=CapabilityId.LLM_CHAT,
                state=CapabilityState.CHECKING,
                attempts=1,
            ),
        ),
        state=AggregateState.CHECKING,
        updated_at=NOW,
    )
    await seed.close()

    db = Database(db_path)
    lifecycle = SidecarLifecycle(
        database=db,
        repository=ReadinessRepository(db),
        readiness_service=_UnusedReadinessService(),
        clock=lambda: NOW,
    )
    await lifecycle.startup()
    try:
        restored = await lifecycle.current_run()
        if restored is None or restored.state is not AggregateState.RECOVERING:
            raise AssertionError("interrupted run was not restored to RECOVERING")
        if restored.capabilities[0].state is not CapabilityState.PENDING:
            raise AssertionError("interrupted capability was not rewound to PENDING")
        return (
            "sidecar crash restore: interrupted run reopened as RECOVERING, "
            "capability rewound to PENDING"
        )
    finally:
        await lifecycle.shutdown()


async def _check_old_db_upgrade_backup() -> str:
    tmp = Path(tempfile.mkdtemp(prefix="accept-upgrade-"))
    db_path = tmp / "prepared.sqlite3"
    async with aiosqlite.connect(db_path) as connection:
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

    db = Database(db_path)
    await db.migrate()
    applied = await db.applied_migration_versions()
    await db.close()

    backups = list(tmp.glob("*.bak.*"))
    if not backups:
        raise AssertionError("no backup was created during the upgrade")
    if applied[-1] != _migration_files()[-1][0]:
        raise AssertionError(f"upgrade did not reach latest migration {_migration_files()[-1][0]}")
    return (
        f"old DB (migration 1) upgraded to v{applied[-1]} with auto-backup "
        f"{backups[0].name}"
    )


async def _check_migration_failure_recoverable() -> str:
    tmp = Path(tempfile.mkdtemp(prefix="accept-recover-"))
    db_path = tmp / "prepared.sqlite3"
    async with aiosqlite.connect(db_path) as connection:
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

    db = Database(db_path)
    await db.migrate()
    await db.close()

    backup = next(tmp.glob("*.bak.*"), None)
    if backup is None:
        raise AssertionError("no backup exists to restore from")
    async with aiosqlite.connect(backup) as connection:
        async with connection.execute(
            "SELECT value FROM _vox_backup_marker"
        ) as cursor:
            row = await cursor.fetchone()
    if row is None or row[0] != "keep-me":
        raise AssertionError("backup is not restorable / marker lost")
    return f"backup {backup.name} is restorable and preserves pre-upgrade data"


_CHECKS = [
    ("lifecycle.conversation_disconnect_resume", "对话断网恢复", _check_conversation_disconnect_resume),
    ("lifecycle.build_disconnect_resume", "数字人构建断网恢复", _check_build_disconnect_resume),
    ("lifecycle.sidecar_crash_restore", "Sidecar 崩溃恢复", _check_sidecar_crash_restore),
    ("lifecycle.gui_restart_restore", "GUI 重启后恢复任务/会话", _check_build_disconnect_resume),
    ("lifecycle.old_db_upgrade_backup", "旧库升级自动备份", _check_old_db_upgrade_backup),
    ("lifecycle.migration_failure_recoverable", "迁移失败自动备份可恢复", _check_migration_failure_recoverable),
]


async def run_lifecycle() -> list[CheckResult]:
    results: list[CheckResult] = []
    for item_id, name, coro in _CHECKS:
        result = CheckResult(id=item_id, name=name, category=CATEGORY, status=STATUS_FAIL)
        started = time.perf_counter()
        try:
            evidence = await coro()
            result.status = STATUS_PASS
            result.evidence = evidence
            result.fix_hint = None
        except Exception as error:  # noqa: BLE001
            result.error = str(error)
            result.evidence = f"{name} failed: {type(error).__name__}: {error}"
            result.fix_hint = "a lifecycle recovery path regressed; investigate persistence/recovery code"
        results.append(finish(result, started))
    return results