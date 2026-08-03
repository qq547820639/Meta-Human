from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Protocol

from voxstudio_core.persistence.readiness_repository import (
    PersistedReadinessRun,
)
from voxstudio_core.readiness.models import (
    CapabilityId,
    CapabilityReadiness,
    CapabilityState,
)


logger = logging.getLogger(__name__)


class LifecycleNotAcceptingError(RuntimeError):
    pass


class DatabaseLifecyclePort(Protocol):
    async def migrate(self) -> None: ...

    async def close(self) -> None: ...


class ReadinessLifecycleRepositoryPort(Protocol):
    async def create_or_get_current_run(
        self,
        capabilities: tuple[CapabilityReadiness, ...],
        *,
        created_at: datetime,
    ) -> PersistedReadinessRun: ...

    async def load_current_run(self) -> PersistedReadinessRun | None: ...

    async def resume_latest_incomplete_run(
        self,
        *,
        resumed_at: datetime,
    ) -> PersistedReadinessRun | None: ...


class ReadinessPreparationPort(Protocol):
    async def prepare(self) -> PersistedReadinessRun: ...


class SidecarLifecycle:
    def __init__(
        self,
        *,
        database: DatabaseLifecyclePort,
        repository: ReadinessLifecycleRepositoryPort,
        readiness_service: ReadinessPreparationPort,
        clock: Callable[[], datetime] | None = None,
        drain_timeout_seconds: float = 2.0,
    ) -> None:
        if drain_timeout_seconds < 0:
            raise ValueError("drain_timeout_seconds must not be negative")
        self._database = database
        self._repository = repository
        self._readiness_service = readiness_service
        self._clock = clock or _utc_now
        self._drain_timeout_seconds = drain_timeout_seconds
        self._lock = asyncio.Lock()
        self._preparation_task: asyncio.Task[PersistedReadinessRun] | None = None
        self._accepting_preparation = False
        self._started = False

    @property
    def accepting_preparation(self) -> bool:
        return self._accepting_preparation

    async def startup(self) -> None:
        async with self._lock:
            if self._started:
                return
            self._accepting_preparation = False
            try:
                await self._database.migrate()
                await self._repository.resume_latest_incomplete_run(
                    resumed_at=self._clock()
                )
            except BaseException as error:
                self._preparation_task = None
                self._started = False
                try:
                    await self._database.close()
                except BaseException:
                    logger.error("Sidecar database cleanup failed during startup")
                raise error
            self._accepting_preparation = True
            self._started = True

    async def current_run(self) -> PersistedReadinessRun | None:
        return await self._repository.load_current_run()

    async def start_or_resume(self) -> PersistedReadinessRun:
        async with self._lock:
            if not self._accepting_preparation:
                raise LifecycleNotAcceptingError

            active_task = self._active_preparation_task()
            if active_task is not None:
                current = await self._repository.load_current_run()
                if current is not None:
                    return current

            now = self._clock()
            current = await self._repository.resume_latest_incomplete_run(
                resumed_at=now
            )
            if current is None:
                current = await self._repository.create_or_get_current_run(
                    _pending_capabilities(),
                    created_at=now,
                )

            task = asyncio.create_task(
                self._run_preparation(),
                name="voxstudio-readiness-prepare",
            )
            self._preparation_task = task
            task.add_done_callback(self._consume_preparation_result)
            return current

    async def shutdown(self) -> None:
        async with self._lock:
            if not self._started:
                return
            self._accepting_preparation = False
            task = self._active_preparation_task()

        try:
            await self._bounded_drain(task)
            await self._repository.resume_latest_incomplete_run(
                resumed_at=self._clock()
            )
        finally:
            await self._database.close()
            async with self._lock:
                self._preparation_task = None
                self._started = False

    def _active_preparation_task(
        self,
    ) -> asyncio.Task[PersistedReadinessRun] | None:
        task = self._preparation_task
        if task is None or task.done():
            return None
        return task

    async def _bounded_drain(
        self,
        task: asyncio.Task[PersistedReadinessRun] | None,
    ) -> None:
        if task is None:
            return
        _, pending = await asyncio.wait(
            {task},
            timeout=self._drain_timeout_seconds,
        )
        if not pending:
            return
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)

    async def _run_preparation(self) -> PersistedReadinessRun:
        task = asyncio.current_task()
        try:
            return await self._readiness_service.prepare()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.error(
                "Readiness preparation failed; persisted checks marked resumable"
            )
            resumed = await self._repository.resume_latest_incomplete_run(
                resumed_at=self._clock()
            )
            if resumed is None:
                raise RuntimeError("readiness recovery found no current run")
            return resumed
        finally:
            async with self._lock:
                if self._preparation_task is task:
                    self._preparation_task = None

    def _consume_preparation_result(
        self,
        task: asyncio.Task[PersistedReadinessRun],
    ) -> None:
        if task.cancelled():
            return
        if task.exception() is not None:
            logger.error("Readiness preparation recovery failed")


def _pending_capabilities() -> tuple[CapabilityReadiness, ...]:
    return tuple(
        CapabilityReadiness(
            id=capability_id,
            required=True,
            state=CapabilityState.PENDING,
        )
        for capability_id in CapabilityId
    )


def _utc_now() -> datetime:
    return datetime.now(UTC)
