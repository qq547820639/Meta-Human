from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum
from uuid import uuid4

import aiosqlite

from voxstudio_core.persistence.database import Database


class BuildJobStatus(StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLING = "cancelling"
    CANCELLED = "cancelled"
    CLEANUP_PENDING = "cleanup_pending"
    CLEANUP_FAILED = "cleanup_failed"


class BuildStage(StrEnum):
    VALIDATE_INPUTS = "validate_inputs"
    ENROLL_VOICE = "enroll_voice"
    ENROLL_AVATAR = "enroll_avatar"
    SAVE_RESULT = "save_result"
    CLEANUP = "cleanup"


class CleanupState(StrEnum):
    """Lifecycle of a build job's remote-resource cleanup.

    ``NONE`` means no remote resources were created (or cleanup was never
    requested). ``PENDING``/``FAILED`` mark a job whose remote resources still
    need to be released — a recoverable state, never confused with completion.
    ``SUCCEEDED`` means the remote cleanup interface was invoked and succeeded.
    """

    NONE = "none"
    PENDING = "pending"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


class BuildJobNotFoundError(LookupError):
    pass


class BuildJobConflictError(RuntimeError):
    pass


#: Build-job intent. "new" creates a fresh digital human, "rebuild" replaces
#: the materials / remote resources of an existing digital human (updating the
#: SAME record on success, keeping the original on failure), and "copy" derives
#: a new digital human from an existing one's materials.
BUILD_JOB_MODES = frozenset({"new", "rebuild", "copy"})


@dataclass(frozen=True, slots=True)
class BuildJob:
    id: str
    status: BuildJobStatus
    current_stage: BuildStage
    created_at: datetime
    updated_at: datetime
    digital_human_id: str | None = None
    idempotency_key: str | None = None
    stage_progress: str | None = None
    succeeded_stages: tuple[BuildStage, ...] = ()
    retry_count: int = 0
    error_code: str | None = None
    error_detail: str | None = None
    cancelled: bool = False
    portrait_path: str | None = None
    recording_path: str | None = None
    completed_at: datetime | None = None
    mode: str = "new"
    staging_voice_id: str | None = None
    staging_avatar_id: str | None = None
    provider: str | None = None
    remote_resource_id: str | None = None
    cleanup_state: CleanupState = CleanupState.NONE
    last_error: str | None = None


class BuildJobRepository:
    def __init__(self, database: Database) -> None:
        self._database = database

    async def create(
        self,
        *,
        portrait_path: str,
        recording_path: str,
        digital_human_id: str | None = None,
        idempotency_key: str | None = None,
        created_at: datetime | None = None,
        job_id: str | None = None,
        mode: str = "new",
        staging_voice_id: str | None = None,
        staging_avatar_id: str | None = None,
        provider: str | None = None,
    ) -> BuildJob:
        resolved_id = job_id or str(uuid4())
        resolved_created_at = created_at or datetime.now(UTC)
        timestamp = _serialize_timestamp(resolved_created_at)
        async with self._database.transaction() as connection:
            if idempotency_key is not None:
                existing = await _find_by_idempotency_key(
                    connection, idempotency_key
                )
                if existing is not None:
                    raise BuildJobConflictError(
                        f"idempotency key already in use: {idempotency_key}"
                    )
            await connection.execute(
                """
                INSERT INTO build_jobs (
                    id, digital_human_id, idempotency_key,
                    current_stage, status, stage_progress, succeeded_stages,
                    retry_count, error_code, error_detail, cancelled,
                    portrait_path, recording_path, created_at, updated_at,
                    completed_at, mode, staging_voice_id, staging_avatar_id,
                    provider, cleanup_state
                ) VALUES (?, ?, ?, ?, ?, NULL, ?, 0, NULL, NULL, 0, ?, ?, ?, ?, NULL,
                ?, ?, ?, ?, 'none')
                """,
                (
                    resolved_id,
                    digital_human_id,
                    idempotency_key,
                    BuildStage.VALIDATE_INPUTS.value,
                    BuildJobStatus.PENDING.value,
                    json.dumps([]),
                    portrait_path,
                    recording_path,
                    timestamp,
                    timestamp,
                    mode,
                    staging_voice_id,
                    staging_avatar_id,
                    provider,
                ),
            )
            return await _load(connection, resolved_id)

    async def get(self, job_id: str) -> BuildJob:
        async with self._database.transaction(immediate=False) as connection:
            return await _load(connection, job_id)

    async def find_by_idempotency_key(
        self, idempotency_key: str
    ) -> BuildJob | None:
        async with self._database.transaction(immediate=False) as connection:
            return await _find_by_idempotency_key(connection, idempotency_key)

    async def list_unfinished(self) -> tuple[BuildJob, ...]:
        async with self._database.transaction(immediate=False) as connection:
            async with connection.execute(
                """
                SELECT * FROM build_jobs
                WHERE status IN ('pending', 'running', 'cancelling')
                ORDER BY updated_at DESC, id DESC
                """
            ) as cursor:
                rows = await cursor.fetchall()
        return tuple(_from_row(row) for row in rows)

    async def list_recent(self, *, limit: int = 1) -> tuple[BuildJob, ...]:
        async with self._database.transaction(immediate=False) as connection:
            async with connection.execute(
                """
                SELECT * FROM build_jobs
                ORDER BY updated_at DESC, id DESC
                LIMIT ?
                """,
                (limit,),
            ) as cursor:
                rows = await cursor.fetchall()
        return tuple(_from_row(row) for row in rows)

    async def latest_for_digital_human(
        self, digital_human_id: str
    ) -> BuildJob | None:
        async with self._database.transaction(immediate=False) as connection:
            async with connection.execute(
                """
                SELECT * FROM build_jobs
                WHERE digital_human_id = ?
                ORDER BY updated_at DESC, id DESC
                LIMIT 1
                """,
                (digital_human_id,),
            ) as cursor:
                row = await cursor.fetchone()
        return None if row is None else _from_row(row)

    async def list_for_digital_human(
        self,
        digital_human_id: str,
        *,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[BuildJob, ...]:
        if limit < 1:
            raise ValueError("limit must be >= 1")
        if offset < 0:
            raise ValueError("offset must be >= 0")
        async with self._database.transaction(immediate=False) as connection:
            async with connection.execute(
                """
                SELECT * FROM build_jobs
                WHERE digital_human_id = ?
                ORDER BY updated_at DESC, id DESC
                LIMIT ? OFFSET ?
                """,
                (digital_human_id, limit, offset),
            ) as cursor:
                rows = await cursor.fetchall()
        return tuple(_from_row(row) for row in rows)

    async def update(
        self,
        job_id: str,
        *,
        status: BuildJobStatus,
        current_stage: BuildStage | None = None,
        stage_progress: str | None = None,
        succeeded_stages: tuple[BuildStage, ...] | None = None,
        retry_count: int | None = None,
        error_code: str | None = None,
        error_detail: str | None = None,
        cancelled: bool | None = None,
        digital_human_id: str | None = None,
        completed_at: datetime | None = None,
        updated_at: datetime | None = None,
        mode: str | None = None,
        staging_voice_id: str | None = None,
        staging_avatar_id: str | None = None,
        provider: str | None = None,
        remote_resource_id: str | None = None,
        cleanup_state: CleanupState | None = None,
        last_error: str | None = None,
    ) -> BuildJob:
        timestamp = _serialize_timestamp(updated_at or datetime.now(UTC))
        async with self._database.transaction() as connection:
            cursor = await connection.execute(
                """
                UPDATE build_jobs
                SET status = ?,
                    current_stage = COALESCE(?, current_stage),
                    stage_progress = COALESCE(?, stage_progress),
                    succeeded_stages = COALESCE(?, succeeded_stages),
                    retry_count = COALESCE(?, retry_count),
                    error_code = COALESCE(?, error_code),
                    error_detail = COALESCE(?, error_detail),
                    cancelled = COALESCE(?, cancelled),
                    digital_human_id = COALESCE(?, digital_human_id),
                    completed_at = COALESCE(?, completed_at),
                    mode = COALESCE(?, mode),
                    staging_voice_id = COALESCE(?, staging_voice_id),
                    staging_avatar_id = COALESCE(?, staging_avatar_id),
                    provider = COALESCE(?, provider),
                    remote_resource_id = COALESCE(?, remote_resource_id),
                    cleanup_state = COALESCE(?, cleanup_state),
                    last_error = COALESCE(?, last_error),
                    updated_at = ?
                WHERE id = ?
                """,
                (
                    status.value,
                    current_stage.value if current_stage else None,
                    stage_progress,
                    json.dumps([s.value for s in succeeded_stages])
                    if succeeded_stages is not None
                    else None,
                    retry_count,
                    error_code,
                    error_detail,
                    int(cancelled) if cancelled is not None else None,
                    digital_human_id,
                    _serialize_timestamp(completed_at) if completed_at else None,
                    mode,
                    staging_voice_id,
                    staging_avatar_id,
                    provider,
                    remote_resource_id,
                    cleanup_state.value if cleanup_state else None,
                    last_error,
                    timestamp,
                    job_id,
                ),
            )
            if cursor.rowcount != 1:
                raise BuildJobNotFoundError(job_id)
            return await _load(connection, job_id)


async def _find_by_idempotency_key(
    connection: aiosqlite.Connection,
    idempotency_key: str,
) -> BuildJob | None:
    async with connection.execute(
        "SELECT * FROM build_jobs WHERE idempotency_key = ?",
        (idempotency_key,),
    ) as cursor:
        row = await cursor.fetchone()
    return None if row is None else _from_row(row)


async def _load(
    connection: aiosqlite.Connection,
    job_id: str,
) -> BuildJob:
    async with connection.execute(
        "SELECT * FROM build_jobs WHERE id = ?",
        (job_id,),
    ) as cursor:
        row = await cursor.fetchone()
    if row is None:
        raise BuildJobNotFoundError(job_id)
    return _from_row(row)


def _from_row(row: aiosqlite.Row) -> BuildJob:
    completed_at = row["completed_at"]
    return BuildJob(
        id=row["id"],
        digital_human_id=row["digital_human_id"],
        idempotency_key=row["idempotency_key"],
        status=BuildJobStatus(row["status"]),
        current_stage=BuildStage(row["current_stage"]),
        stage_progress=row["stage_progress"],
        succeeded_stages=tuple(
            BuildStage(stage) for stage in json.loads(row["succeeded_stages"])
        ),
        retry_count=row["retry_count"],
        error_code=row["error_code"],
        error_detail=row["error_detail"],
        cancelled=bool(row["cancelled"]),
        portrait_path=row["portrait_path"],
        recording_path=row["recording_path"],
        created_at=_deserialize_timestamp(row["created_at"]),
        updated_at=_deserialize_timestamp(row["updated_at"]),
        completed_at=(
            None if completed_at is None else _deserialize_timestamp(completed_at)
        ),
        mode=row["mode"] if "mode" in row.keys() else "new",
        staging_voice_id=row["staging_voice_id"]
        if "staging_voice_id" in row.keys()
        else None,
        staging_avatar_id=row["staging_avatar_id"]
        if "staging_avatar_id" in row.keys()
        else None,
        provider=row["provider"] if "provider" in row.keys() else None,
        remote_resource_id=row["remote_resource_id"]
        if "remote_resource_id" in row.keys()
        else None,
        cleanup_state=(
            CleanupState(row["cleanup_state"])
            if "cleanup_state" in row.keys() and row["cleanup_state"]
            else CleanupState.NONE
        ),
        last_error=row["last_error"] if "last_error" in row.keys() else None,
    )


def _serialize_timestamp(timestamp: datetime) -> str:
    if timestamp.tzinfo is None or timestamp.utcoffset() is None:
        raise ValueError("timestamps must include a timezone")
    return timestamp.astimezone(UTC).isoformat(timespec="microseconds")


def _deserialize_timestamp(timestamp: str) -> datetime:
    return datetime.fromisoformat(timestamp)
