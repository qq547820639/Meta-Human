from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import uuid4

import aiosqlite

from voxstudio_core.persistence.database import Database
from voxstudio_core.readiness.models import (
    AggregateState,
    CapabilityId,
    CapabilityReadiness,
    CapabilityState,
)


class RunNotFoundError(LookupError):
    pass


class CapabilityNotFoundError(LookupError):
    pass


@dataclass(frozen=True, slots=True)
class SafeError:
    code: str
    message: str
    retryable: bool
    recommended_action: str | None = None


@dataclass(frozen=True, slots=True)
class CapabilityUpdate:
    id: CapabilityId
    state: CapabilityState
    attempts: int
    safe_detail: str | None = None
    error: SafeError | None = None


@dataclass(frozen=True, slots=True)
class PersistedCapability:
    id: CapabilityId
    required: bool
    state: CapabilityState
    attempts: int
    safe_detail: str | None
    error: SafeError | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class PersistedReadinessRun:
    id: str
    state: AggregateState
    capabilities: tuple[PersistedCapability, ...]
    created_at: datetime
    updated_at: datetime
    completed_at: datetime | None


_CAPABILITY_POSITIONS = {
    capability_id: position for position, capability_id in enumerate(CapabilityId)
}


class ReadinessRepository:
    def __init__(self, database: Database) -> None:
        self._database = database

    async def create_or_get_current_run(
        self,
        capabilities: list[CapabilityReadiness]
        | tuple[CapabilityReadiness, ...],
        *,
        run_id: str | None = None,
        created_at: datetime | None = None,
    ) -> PersistedReadinessRun:
        ordered_capabilities = _ordered_capabilities(capabilities)
        resolved_run_id = run_id or str(uuid4())
        resolved_created_at = created_at or datetime.now(UTC)
        timestamp = _serialize_timestamp(resolved_created_at)

        async with self._database.transaction() as connection:
            current_run_id = await _current_run_id(connection)
            if current_run_id is not None:
                return await _load_run(connection, current_run_id)

            await connection.execute(
                """
                INSERT INTO readiness_runs (
                    id, state, created_at, updated_at, completed_at
                ) VALUES (?, ?, ?, ?, NULL)
                """,
                (
                    resolved_run_id,
                    AggregateState.PENDING.value,
                    timestamp,
                    timestamp,
                ),
            )
            for position, capability in enumerate(ordered_capabilities):
                await connection.execute(
                    """
                    INSERT INTO readiness_capabilities (
                        run_id,
                        capability_id,
                        position,
                        required,
                        state,
                        attempts,
                        safe_detail,
                        created_at,
                        updated_at
                    ) VALUES (?, ?, ?, ?, ?, 0, NULL, ?, ?)
                    """,
                    (
                        resolved_run_id,
                        capability.id.value,
                        position,
                        int(capability.required),
                        capability.state.value,
                        timestamp,
                        timestamp,
                    ),
                )
            return await _load_run(connection, resolved_run_id)

    async def update_capabilities(
        self,
        run_id: str,
        updates: tuple[CapabilityUpdate, ...] | list[CapabilityUpdate],
        *,
        state: AggregateState,
        updated_at: datetime,
    ) -> PersistedReadinessRun:
        updates = tuple(updates)
        _validate_updates(updates)
        timestamp = _serialize_timestamp(updated_at)

        async with self._database.transaction() as connection:
            cursor = await connection.execute(
                """
                UPDATE readiness_runs
                SET state = ?, updated_at = ?
                WHERE id = ?
                """,
                (state.value, timestamp, run_id),
            )
            if cursor.rowcount != 1:
                raise RunNotFoundError(run_id)

            for update in updates:
                cursor = await connection.execute(
                    """
                    UPDATE readiness_capabilities
                    SET state = ?, attempts = ?, safe_detail = ?, updated_at = ?
                    WHERE run_id = ? AND capability_id = ?
                    """,
                    (
                        update.state.value,
                        update.attempts,
                        update.safe_detail,
                        timestamp,
                        run_id,
                        update.id.value,
                    ),
                )
                if cursor.rowcount != 1:
                    raise CapabilityNotFoundError(
                        f"{run_id}:{update.id.value}"
                    )

                await connection.execute(
                    """
                    DELETE FROM readiness_errors
                    WHERE run_id = ? AND capability_id = ?
                    """,
                    (run_id, update.id.value),
                )
                if update.error is not None:
                    await connection.execute(
                        """
                        INSERT INTO readiness_errors (
                            run_id,
                            capability_id,
                            code,
                            message,
                            retryable,
                            recommended_action
                        ) VALUES (?, ?, ?, ?, ?, ?)
                        """,
                        (
                            run_id,
                            update.id.value,
                            update.error.code,
                            update.error.message,
                            int(update.error.retryable),
                            update.error.recommended_action,
                        ),
                    )
            return await _load_run(connection, run_id)

    async def complete_run(
        self,
        run_id: str,
        *,
        state: AggregateState,
        completed_at: datetime,
    ) -> PersistedReadinessRun:
        timestamp = _serialize_timestamp(completed_at)
        async with self._database.transaction() as connection:
            cursor = await connection.execute(
                """
                UPDATE readiness_runs
                SET state = ?, updated_at = ?, completed_at = ?
                WHERE id = ?
                """,
                (state.value, timestamp, timestamp, run_id),
            )
            if cursor.rowcount != 1:
                raise RunNotFoundError(run_id)
            return await _load_run(connection, run_id)

    async def load_run(self, run_id: str) -> PersistedReadinessRun | None:
        async with self._database.transaction(immediate=False) as connection:
            return await _load_run_or_none(connection, run_id)

    async def load_current_run(self) -> PersistedReadinessRun | None:
        async with self._database.transaction(immediate=False) as connection:
            run_id = await _current_run_id(connection)
            if run_id is None:
                return None
            return await _load_run(connection, run_id)

    async def resume_latest_incomplete_run(
        self,
        *,
        resumed_at: datetime,
    ) -> PersistedReadinessRun | None:
        timestamp = _serialize_timestamp(resumed_at)
        async with self._database.transaction() as connection:
            run_id = await _current_run_id(connection)
            if run_id is None:
                return None

            async with connection.execute(
                """
                SELECT capability_id
                FROM readiness_capabilities
                WHERE run_id = ? AND state = ?
                ORDER BY position, capability_id
                """,
                (run_id, CapabilityState.CHECKING.value),
            ) as cursor:
                interrupted_capabilities = tuple(
                    row["capability_id"] for row in await cursor.fetchall()
                )

            if interrupted_capabilities:
                await connection.execute(
                    """
                    DELETE FROM readiness_errors
                    WHERE run_id = ?
                      AND capability_id IN (
                          SELECT capability_id
                          FROM readiness_capabilities
                          WHERE run_id = ? AND state = ?
                      )
                    """,
                    (run_id, run_id, CapabilityState.CHECKING.value),
                )
                await connection.execute(
                    """
                    UPDATE readiness_capabilities
                    SET state = ?, safe_detail = NULL, updated_at = ?
                    WHERE run_id = ? AND state = ?
                    """,
                    (
                        CapabilityState.PENDING.value,
                        timestamp,
                        run_id,
                        CapabilityState.CHECKING.value,
                    ),
                )
                await connection.execute(
                    """
                    UPDATE readiness_runs
                    SET state = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (AggregateState.RECOVERING.value, timestamp, run_id),
                )

            return await _load_run(connection, run_id)


def _ordered_capabilities(
    capabilities: list[CapabilityReadiness] | tuple[CapabilityReadiness, ...],
) -> tuple[CapabilityReadiness, ...]:
    capabilities_by_id: dict[CapabilityId, CapabilityReadiness] = {}
    for capability in capabilities:
        if capability.id in capabilities_by_id:
            raise ValueError(f"duplicate capability: {capability.id.value}")
        capabilities_by_id[capability.id] = capability
    return tuple(
        capabilities_by_id[capability_id]
        for capability_id in CapabilityId
        if capability_id in capabilities_by_id
    )


def _validate_updates(updates: tuple[CapabilityUpdate, ...]) -> None:
    capability_ids: set[CapabilityId] = set()
    for update in updates:
        if update.id in capability_ids:
            raise ValueError(f"duplicate capability update: {update.id.value}")
        if update.attempts < 0:
            raise ValueError("attempts must not be negative")
        capability_ids.add(update.id)


async def _current_run_id(connection: aiosqlite.Connection) -> str | None:
    async with connection.execute(
        """
        SELECT id
        FROM readiness_runs
        WHERE completed_at IS NULL
        ORDER BY created_at DESC, id DESC
        LIMIT 1
        """
    ) as cursor:
        row = await cursor.fetchone()
    return None if row is None else row["id"]


async def _load_run(
    connection: aiosqlite.Connection,
    run_id: str,
) -> PersistedReadinessRun:
    run = await _load_run_or_none(connection, run_id)
    if run is None:
        raise RunNotFoundError(run_id)
    return run


async def _load_run_or_none(
    connection: aiosqlite.Connection,
    run_id: str,
) -> PersistedReadinessRun | None:
    async with connection.execute(
        """
        SELECT id, state, created_at, updated_at, completed_at
        FROM readiness_runs
        WHERE id = ?
        """,
        (run_id,),
    ) as cursor:
        run_row = await cursor.fetchone()
    if run_row is None:
        return None

    async with connection.execute(
        """
        SELECT
            capability.capability_id,
            capability.required,
            capability.state,
            capability.attempts,
            capability.safe_detail,
            capability.created_at,
            capability.updated_at,
            error.code AS error_code,
            error.message AS error_message,
            error.retryable AS error_retryable,
            error.recommended_action AS error_recommended_action
        FROM readiness_capabilities AS capability
        LEFT JOIN readiness_errors AS error
          ON error.run_id = capability.run_id
         AND error.capability_id = capability.capability_id
        WHERE capability.run_id = ?
        ORDER BY capability.position, capability.capability_id
        """,
        (run_id,),
    ) as cursor:
        capability_rows = await cursor.fetchall()

    capabilities = tuple(_persisted_capability(row) for row in capability_rows)
    completed_at = run_row["completed_at"]
    return PersistedReadinessRun(
        id=run_row["id"],
        state=AggregateState(run_row["state"]),
        capabilities=capabilities,
        created_at=_deserialize_timestamp(run_row["created_at"]),
        updated_at=_deserialize_timestamp(run_row["updated_at"]),
        completed_at=(
            None if completed_at is None else _deserialize_timestamp(completed_at)
        ),
    )


def _persisted_capability(row: aiosqlite.Row) -> PersistedCapability:
    error = None
    if row["error_code"] is not None:
        error = SafeError(
            code=row["error_code"],
            message=row["error_message"],
            retryable=bool(row["error_retryable"]),
            recommended_action=row["error_recommended_action"],
        )
    return PersistedCapability(
        id=CapabilityId(row["capability_id"]),
        required=bool(row["required"]),
        state=CapabilityState(row["state"]),
        attempts=row["attempts"],
        safe_detail=row["safe_detail"],
        error=error,
        created_at=_deserialize_timestamp(row["created_at"]),
        updated_at=_deserialize_timestamp(row["updated_at"]),
    )


def _serialize_timestamp(timestamp: datetime) -> str:
    if timestamp.tzinfo is None or timestamp.utcoffset() is None:
        raise ValueError("timestamps must include a timezone")
    return timestamp.astimezone(UTC).isoformat(timespec="microseconds")


def _deserialize_timestamp(timestamp: str) -> datetime:
    return datetime.fromisoformat(timestamp)
