from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Protocol

from voxstudio_core.persistence.build_job_repository import (
    BuildJob,
    BuildJobConflictError,
    BuildJobNotFoundError,
    BuildJobRepository,
    BuildJobStatus,
    BuildStage,
)
from voxstudio_core.persistence.digital_human_repository import (
    DigitalHumanRepository,
    DigitalHumanStatus,
)
from voxstudio_core.providers.remote_gpu import RemoteGpuClient

logger = logging.getLogger(__name__)


class BuildJobUnavailableError(RuntimeError):
    pass


class BuildJobConflict(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class BuildJobResult:
    voice_id: str
    avatar_id: str


class BuildJobExecutionPort(Protocol):
    async def run(self, job: BuildJob) -> BuildJobResult: ...


class _StageFailure(Exception):
    def __init__(self, stage: BuildStage, code: str, detail: str) -> None:
        super().__init__(detail)
        self.stage = stage
        self.code = code
        self.detail = detail


class BuildJobService:
    """Server-side build job state machine with idempotency, cancel, retry,
    and compensation cleanup."""

    def __init__(
        self,
        *,
        repository: BuildJobRepository,
        digital_humans: DigitalHumanRepository,
        client: RemoteGpuClient,
        max_portrait_bytes: int = 20_971_520,
        max_recording_bytes: int = 25_165_824,
        max_retries: int = 3,
        clock=None,
    ) -> None:
        self._repository = repository
        self._digital_humans = digital_humans
        self._client = client
        self._max_portrait_bytes = max_portrait_bytes
        self._max_recording_bytes = max_recording_bytes
        self._max_retries = max_retries
        self._clock = clock or _utc_now
        self._lock = asyncio.Lock()
        self._tasks: dict[str, asyncio.Task[None]] = {}

    async def start(
        self,
        *,
        portrait_path: str,
        recording_path: str,
        idempotency_key: str | None = None,
        digital_human_id: str | None = None,
    ) -> BuildJob:
        if idempotency_key is not None:
            existing = await self._repository.find_by_idempotency_key(
                idempotency_key
            )
            if existing is not None:
                return existing
        job = await self._repository.create(
            portrait_path=portrait_path,
            recording_path=recording_path,
            digital_human_id=digital_human_id,
            idempotency_key=idempotency_key,
            created_at=self._clock(),
        )
        await self._spawn(job)
        return job

    async def get(self, job_id: str) -> BuildJob:
        return await self._repository.get(job_id)

    async def current(self) -> BuildJob | None:
        """Return the most recent unfinished build job, if any. Completed jobs
        are never reported here so the UI cannot mistake a finished job for a
        resumable one."""
        unfinished = await self._repository.list_unfinished()
        return unfinished[0] if unfinished else None

    async def recent(self) -> BuildJob | None:
        """Return the most recent build job, including completed ones."""
        recent = await self._repository.list_recent(limit=1)
        return recent[0] if recent else None

    async def cancel(self, job_id: str) -> BuildJob:
        job = await self._repository.get(job_id)
        if job.status not in (
            BuildJobStatus.PENDING,
            BuildJobStatus.RUNNING,
        ):
            raise BuildJobConflict(
                f"job is not cancellable in state {job.status.value}"
            )
        return await self._repository.update(
            job_id,
            status=BuildJobStatus.CANCELLING,
            cancelled=True,
            updated_at=self._clock(),
        )

    async def retry(self, job_id: str) -> BuildJob:
        job = await self._repository.get(job_id)
        if job.status not in (
            BuildJobStatus.FAILED,
            BuildJobStatus.CLEANUP_FAILED,
        ):
            raise BuildJobConflict(
                f"job is not retryable in state {job.status.value}"
            )
        if job.retry_count >= self._max_retries:
            raise BuildJobConflict("job has exhausted its retry limit")
        job = await self._repository.update(
            job_id,
            status=BuildJobStatus.PENDING,
            current_stage=BuildStage.VALIDATE_INPUTS,
            error_code=None,
            error_detail=None,
            cancelled=False,
            retry_count=job.retry_count + 1,
            updated_at=self._clock(),
        )
        await self._spawn(job)
        return job

    async def cleanup(self, job_id: str) -> BuildJob:
        job = await self._repository.get(job_id)
        if job.status not in (
            BuildJobStatus.CANCELLED,
            BuildJobStatus.FAILED,
            BuildJobStatus.CLEANUP_PENDING,
            BuildJobStatus.CLEANUP_FAILED,
        ):
            raise BuildJobConflict(
                f"job is not cleanable in state {job.status.value}"
            )
        job = await self._repository.update(
            job_id,
            status=BuildJobStatus.CLEANUP_PENDING,
            current_stage=BuildStage.CLEANUP,
            updated_at=self._clock(),
        )
        await self._spawn(job)
        return job

    async def resume(self) -> None:
        """Re-drive interrupted jobs after a restart.

        Satisfies ``StartupResumePort`` (``create_app`` calls ``resume()`` on
        startup to re-drive jobs interrupted by a previous shutdown).
        """
        for job in await self._repository.list_unfinished():
            await self._spawn(job)

    async def _spawn(self, job: BuildJob) -> None:
        async with self._lock:
            existing = self._tasks.get(job.id)
            if existing is not None and not existing.done():
                return
            task = asyncio.create_task(
                self._drive(job.id),
                name=f"voxstudio-build-job-{job.id}",
            )
            self._tasks[job.id] = task
            task.add_done_callback(self._consume(job.id))

    def _consume(self, job_id: str) -> None:
        def _done(task: asyncio.Task[None]) -> None:
            if task.cancelled():
                return
            if task.exception() is not None:
                logger.error("Build job crashed unexpectedly", exc_info=True)
            current = self._tasks.get(job_id)
            if current is task:
                self._tasks.pop(job_id, None)

        return _done

    async def _drive(self, job_id: str) -> None:
        job = await self._repository.get(job_id)
        if job.status is BuildJobStatus.CANCELLING:
            await self._mark_cancelled(job)
            return
        if job.status is BuildJobStatus.CLEANUP_PENDING:
            await self._run_cleanup(job)
            return
        if job.status not in (BuildJobStatus.PENDING, BuildJobStatus.RUNNING):
            return

        job = await self._repository.update(
            job_id,
            status=BuildJobStatus.RUNNING,
            current_stage=BuildStage.VALIDATE_INPUTS,
            updated_at=self._clock(),
        )
        succeeded = set(job.succeeded_stages)
        try:
            if BuildStage.VALIDATE_INPUTS not in succeeded:
                await self._run_stage(job, BuildStage.VALIDATE_INPUTS)
                succeeded.add(BuildStage.VALIDATE_INPUTS)
                job = await self._persist_success(job, succeeded)

            if BuildStage.ENROLL_VOICE not in succeeded:
                await self._check_cancelled(job, BuildStage.ENROLL_VOICE)
                audio = _read_media(
                    Path(job.recording_path), self._max_recording_bytes
                )
                voice_id = await self._client.enroll_voice(audio=audio)
                succeeded.add(BuildStage.ENROLL_VOICE)
                job = await self._persist_success(
                    job, succeeded, voice_id=voice_id
                )

            if BuildStage.ENROLL_AVATAR not in succeeded:
                await self._check_cancelled(job, BuildStage.ENROLL_AVATAR)
                image = _read_media(
                    Path(job.portrait_path), self._max_portrait_bytes
                )
                avatar_id = await self._client.enroll_avatar(image=image)
                succeeded.add(BuildStage.ENROLL_AVATAR)
                job = await self._persist_success(
                    job, succeeded, avatar_id=avatar_id
                )

            if BuildStage.SAVE_RESULT not in succeeded:
                await self._check_cancelled(job, BuildStage.SAVE_RESULT)
                await self._save_result(job)
                succeeded.add(BuildStage.SAVE_RESULT)
                job = await self._persist_success(job, succeeded)
        except _StageFailure as failure:
            await self._handle_failure(job, failure)
            return
        except asyncio.CancelledError:
            raise
        except Exception as error:
            await self._handle_failure(
                job,
                _StageFailure(
                    job.current_stage,
                    "build_internal_error",
                    str(error),
                ),
            )
            return

        await self._repository.update(
            job_id,
            status=BuildJobStatus.SUCCEEDED,
            completed_at=self._clock(),
            updated_at=self._clock(),
        )
        if job.digital_human_id is not None:
            await self._digital_humans.update_status(
                job.digital_human_id,
                status=DigitalHumanStatus.READY,
                progress="done",
                updated_at=self._clock(),
            )

    async def _run_stage(
        self, job: BuildJob, stage: BuildStage
    ) -> None:
        job = await self._repository.update(
            job.id,
            status=BuildJobStatus.RUNNING,
            current_stage=stage,
            updated_at=self._clock(),
        )
        await self._check_cancelled(job, stage)
        if stage is BuildStage.VALIDATE_INPUTS:
            _read_media(
                Path(job.recording_path), self._max_recording_bytes
            )
            _read_media(Path(job.portrait_path), self._max_portrait_bytes)

    async def _check_cancelled(self, job: BuildJob, stage: BuildStage) -> None:
        current = await self._repository.get(job.id)
        if current.cancelled:
            raise _StageFailure(
                stage, "job_cancelled", "build was cancelled by the user"
            )

    async def _persist_success(
        self,
        job: BuildJob,
        succeeded: set[BuildStage],
        *,
        voice_id: str | None = None,
        avatar_id: str | None = None,
    ) -> BuildJob:
        if job.digital_human_id is not None and (
            voice_id is not None or avatar_id is not None
        ):
            await self._digital_humans.update_status(
                job.digital_human_id,
                status=DigitalHumanStatus.BUILDING,
                voice_id=voice_id,
                avatar_id=avatar_id,
                updated_at=self._clock(),
            )
        return await self._repository.update(
            job.id,
            status=BuildJobStatus.RUNNING,
            succeeded_stages=tuple(sorted(succeeded, key=lambda s: s.value)),
            updated_at=self._clock(),
        )

    async def _save_result(self, job: BuildJob) -> None:
        if job.digital_human_id is None:
            return
        await self._digital_humans.update_status(
            job.digital_human_id,
            status=DigitalHumanStatus.BUILDING,
            progress="saving",
            updated_at=self._clock(),
        )

    async def _handle_failure(
        self, job: BuildJob, failure: _StageFailure
    ) -> None:
        if failure.code == "job_cancelled":
            await self._mark_cancelled(job)
            return
        await self._repository.update(
            job.id,
            status=BuildJobStatus.FAILED,
            error_code=failure.code,
            error_detail=failure.detail,
            updated_at=self._clock(),
        )
        if job.digital_human_id is not None:
            await self._digital_humans.update_status(
                job.digital_human_id,
                status=DigitalHumanStatus.FAILED,
                error=failure.detail,
                updated_at=self._clock(),
            )

    async def _mark_cancelled(self, job: BuildJob) -> None:
        await self._repository.update(
            job.id,
            status=BuildJobStatus.CANCELLED,
            completed_at=self._clock(),
            updated_at=self._clock(),
        )
        if job.digital_human_id is not None:
            await self._digital_humans.update_status(
                job.digital_human_id,
                status=DigitalHumanStatus.CANCELLED,
                updated_at=self._clock(),
            )

    async def _run_cleanup(self, job: BuildJob) -> None:
        # Best-effort remote cleanup. The current provider has no deletion
        # endpoint for enrollments; we record the remote ids created and mark
        # the job so cleanup can be retried later.
        try:
            await self._repository.update(
                job.id,
                status=BuildJobStatus.CLEANUP_PENDING,
                current_stage=BuildStage.CLEANUP,
                updated_at=self._clock(),
            )
            remote_ids = [
                value
                for value in (
                    await self._remote_ids(job)
                )
            ]
            if remote_ids:
                logger.info(
                    "Build job remote cleanup requested",
                    extra={"job_id": job.id, "remote_ids": remote_ids},
                )
            await self._repository.update(
                job.id,
                status=BuildJobStatus.CANCELLED,
                completed_at=self._clock(),
                updated_at=self._clock(),
            )
        except Exception as error:
            await self._repository.update(
                job.id,
                status=BuildJobStatus.CLEANUP_FAILED,
                error_code="cleanup_failed",
                error_detail=str(error),
                updated_at=self._clock(),
            )

    async def _remote_ids(self, job: BuildJob) -> tuple[str, ...]:
        current = await self._repository.get(job.id)
        result: list[str] = []
        if current.digital_human_id is not None:
            human = await self._digital_humans.get(current.digital_human_id)
            if human.voice_id:
                result.append(human.voice_id)
            if human.avatar_id:
                result.append(human.avatar_id)
        return tuple(result)


def _read_media(path: Path, max_bytes: int) -> bytes:
    if not path.is_file():
        raise _StageFailure(
            BuildStage.VALIDATE_INPUTS,
            "media_missing",
            f"media file is missing: {path}",
        )
    data = path.read_bytes()
    if len(data) > max_bytes:
        raise _StageFailure(
            BuildStage.VALIDATE_INPUTS,
            "media_too_large",
            "media file exceeds the size limit",
        )
    return data


def _utc_now() -> datetime:
    return datetime.now(UTC)