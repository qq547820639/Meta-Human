from __future__ import annotations

import asyncio
import json
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
    CleanupState,
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
        mode: str = "new",
    ) -> BuildJob:
        if idempotency_key is not None:
            existing = await self._repository.find_by_idempotency_key(
                idempotency_key
            )
            if existing is not None:
                return existing
        provider = await self._provider_for(digital_human_id)
        job = await self._repository.create(
            portrait_path=portrait_path,
            recording_path=recording_path,
            digital_human_id=digital_human_id,
            idempotency_key=idempotency_key,
            created_at=self._clock(),
            mode=mode,
            provider=provider,
        )
        await self._spawn(job)
        return job

    async def _provider_for(
        self, digital_human_id: str | None
    ) -> str | None:
        """Best-effort provider identifier for a job, derived from the digital
        human's provider binding when available."""
        if digital_human_id is None:
            return None
        try:
            human = await self._digital_humans.get(digital_human_id)
        except Exception:
            return None
        return human.avatar_provider_id or human.voice_provider_id

    async def get(self, job_id: str) -> BuildJob:
        return await self._repository.get(job_id)

    async def latest_for_digital_human(
        self, digital_human_id: str
    ) -> BuildJob | None:
        return await self._repository.latest_for_digital_human(digital_human_id)

    async def list_for_digital_human(
        self,
        digital_human_id: str,
        *,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[BuildJob, ...]:
        return await self._repository.list_for_digital_human(
            digital_human_id, limit=limit, offset=offset
        )

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
            cleanup_state=CleanupState.NONE,
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

        # Commit the result to the digital human BEFORE marking the job
        # succeeded, so an observer that sees SUCCEEDED can rely on the rebuilt /
        # copied human already reflecting the new remote resources. For
        # rebuild/copy this is an atomic swap (staging -> live); for new it
        # marks the freshly built human READY.
        await self._commit_result(job)
        await self._repository.update(
            job_id,
            status=BuildJobStatus.SUCCEEDED,
            completed_at=self._clock(),
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
        staging_voice: str | None = None
        staging_avatar: str | None = None
        if job.mode in ("rebuild", "copy"):
            # Stage the newly enrolled remote resources on the job. Do NOT
            # touch the original digital human: a later failure must keep the
            # original available version intact. The staged ids are committed
            # to the digital human only on success (see `_commit_result`).
            current = await self._repository.get(job.id)
            staging_voice = current.staging_voice_id
            staging_avatar = current.staging_avatar_id
            if voice_id is not None:
                staging_voice = voice_id
            if avatar_id is not None:
                staging_avatar = avatar_id
        elif job.digital_human_id is not None and (
            voice_id is not None or avatar_id is not None
        ):
            await self._digital_humans.update_status(
                job.digital_human_id,
                status=DigitalHumanStatus.BUILDING,
                voice_id=voice_id,
                avatar_id=avatar_id,
                updated_at=self._clock(),
            )
        current = await self._repository.get(job.id)
        remote_resources = _merge_remote_resources(
            current.remote_resource_id, voice_id, avatar_id
        )
        return await self._repository.update(
            job.id,
            status=BuildJobStatus.RUNNING,
            succeeded_stages=tuple(sorted(succeeded, key=lambda s: s.value)),
            updated_at=self._clock(),
            staging_voice_id=staging_voice,
            staging_avatar_id=staging_avatar,
            remote_resource_id=remote_resources,
            provider=current.provider or job.provider,
        )

    async def _save_result(self, job: BuildJob) -> None:
        if job.mode != "new" or job.digital_human_id is None:
            return
        await self._digital_humans.update_status(
            job.digital_human_id,
            status=DigitalHumanStatus.BUILDING,
            progress="saving",
            updated_at=self._clock(),
        )

    async def _commit_result(self, job: BuildJob) -> None:
        """Make the build result the live digital human, atomically.

        - ``new``: the human was already updated during staging; mark READY.
        - ``rebuild``: update the SAME record with the staged resources.
        - ``copy``: create a NEW digital human record from the job materials.
        """
        if job.digital_human_id is None:
            return
        current = await self._repository.get(job.id)
        voice_id = current.staging_voice_id
        avatar_id = current.staging_avatar_id
        if job.mode == "rebuild":
            await self._digital_humans.update_status(
                job.digital_human_id,
                status=DigitalHumanStatus.READY,
                progress="done",
                voice_id=voice_id,
                avatar_id=avatar_id,
                updated_at=self._clock(),
            )
            return
        if job.mode == "copy":
            source = await self._digital_humans.get(job.digital_human_id)
            created = await self._digital_humans.create(
                name=f"{source.name}（副本）",
                portrait_path=job.portrait_path,
                recording_path=job.recording_path,
                voice_provider_id=source.voice_provider_id,
                avatar_provider_id=source.avatar_provider_id,
            )
            await self._digital_humans.update_status(
                created.id,
                status=DigitalHumanStatus.READY,
                progress="done",
                voice_id=voice_id,
                avatar_id=avatar_id,
                updated_at=self._clock(),
            )
            return
        await self._digital_humans.update_status(
            job.digital_human_id,
            status=DigitalHumanStatus.READY,
            progress="done",
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
            last_error=failure.detail,
            updated_at=self._clock(),
        )
        if job.mode == "new" and job.digital_human_id is not None:
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
        if job.mode == "new" and job.digital_human_id is not None:
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
                cleanup_state=CleanupState.PENDING,
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
                cleanup_state=CleanupState.SUCCEEDED,
                completed_at=self._clock(),
                updated_at=self._clock(),
            )
        except Exception as error:
            await self._repository.update(
                job.id,
                status=BuildJobStatus.CLEANUP_FAILED,
                error_code="cleanup_failed",
                error_detail=str(error),
                last_error=str(error),
                cleanup_state=CleanupState.FAILED,
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


def _merge_remote_resources(
    existing: str | None,
    voice_id: str | None,
    avatar_id: str | None,
) -> str:
    """Merge newly created remote resource ids into the job's serialized (JSON)
    ``remote_resource_id`` value, preserving previously recorded ids."""
    resources: list[str] = []
    if existing:
        try:
            parsed = json.loads(existing)
            if isinstance(parsed, list):
                resources = [str(item) for item in parsed]
        except (TypeError, ValueError):
            resources = []
    for value in (voice_id, avatar_id):
        if value and value not in resources:
            resources.append(value)
    return json.dumps(resources)