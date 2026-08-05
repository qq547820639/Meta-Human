from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field

from voxstudio_core.persistence.build_job_repository import (
    BuildJob,
    BuildJobNotFoundError,
    CleanupState,
)
from voxstudio_core.persistence.digital_human_repository import (
    DigitalHuman,
    DigitalHumanNotFoundError,
    DigitalHumanRepository,
)
from voxstudio_core.providers.build_job_service import (
    BuildJobConflict,
    BuildJobService,
)
from voxstudio_core.providers.remote_gpu import RemoteGpuClient
from voxstudio_core.security import BearerTokenGuard


class BuildJobRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    portrait_path: str = Field(min_length=1)
    recording_path: str = Field(min_length=1)
    idempotency_key: str | None = Field(default=None, max_length=128)
    digital_human_id: str | None = None
    mode: Literal["new", "rebuild", "copy"] = "new"


class BuildJobResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    status: str
    current_stage: str
    stage_progress: str | None = None
    succeeded_stages: tuple[str, ...]
    retry_count: int
    error_code: str | None = None
    error_detail: str | None = None
    cancelled: bool
    digital_human_id: str | None = None
    mode: str = "new"
    provider: str | None = None
    remote_resource_id: str | None = None
    cleanup_state: str = "none"
    last_error: str | None = None
    created_at: str
    updated_at: str
    completed_at: str | None = None


class BuildJobHistoryResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    jobs: tuple[BuildJobResponse, ...]
    has_more: bool


class DigitalHumanResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    name: str
    voice_provider_id: str | None = None
    avatar_provider_id: str | None = None
    voice_id: str | None = None
    avatar_id: str | None = None
    creation_status: str
    creation_progress: str | None = None
    is_default: bool
    error: str | None = None
    portrait_path: str | None = None
    recording_path: str | None = None
    remote_status: str | None = None
    created_at: str
    updated_at: str


class DigitalHumanListResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    humans: tuple[DigitalHumanResponse, ...]
    total: int = 0
    has_more: bool = False


class RenameDigitalHumanRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=200)


class AvatarStreamStartRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    avatar_id: str = Field(min_length=1)
    voice_id: str = Field(min_length=1)


class AvatarStreamStartResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    session_id: str
    stream_url: str | None = None


def create_avatar_router(
    *,
    guard: BearerTokenGuard,
    build_jobs: BuildJobService,
    digital_humans: DigitalHumanRepository,
    stream_client: RemoteGpuClient | None = None,
) -> APIRouter:
    router = APIRouter(dependencies=[Depends(guard)])

    @router.post(
        "/v1/avatar/jobs",
        response_model=BuildJobResponse,
        status_code=status.HTTP_202_ACCEPTED,
    )
    async def start_build(payload: BuildJobRequest) -> BuildJobResponse:
        job = await build_jobs.start(
            portrait_path=payload.portrait_path,
            recording_path=payload.recording_path,
            idempotency_key=payload.idempotency_key,
            digital_human_id=payload.digital_human_id,
            mode=payload.mode,
        )
        return _build_job_response(job)

    @router.get(
        "/v1/avatar/jobs/current",
        response_model=BuildJobResponse | None,
    )
    async def current_build_job() -> BuildJobResponse | None:
        job = await build_jobs.current()
        return None if job is None else _build_job_response(job)

    @router.get(
        "/v1/avatar/jobs/recent",
        response_model=BuildJobResponse | None,
    )
    async def recent_build_job() -> BuildJobResponse | None:
        job = await build_jobs.recent()
        return None if job is None else _build_job_response(job)

    @router.get(
        "/v1/avatar/jobs/{job_id}",
        response_model=BuildJobResponse,
    )
    async def get_build_job(job_id: str) -> BuildJobResponse:
        try:
            job = await build_jobs.get(job_id)
        except BuildJobNotFoundError as error:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=str(error),
            ) from error
        return _build_job_response(job)

    @router.post(
        "/v1/avatar/jobs/{job_id}/cancel",
        response_model=BuildJobResponse,
    )
    async def cancel_build_job(job_id: str) -> BuildJobResponse:
        try:
            job = await build_jobs.cancel(job_id)
        except BuildJobNotFoundError as error:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=str(error),
            ) from error
        except BuildJobConflict as error:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=str(error),
            ) from error
        return _build_job_response(job)

    @router.post(
        "/v1/avatar/jobs/{job_id}/retry",
        response_model=BuildJobResponse,
    )
    async def retry_build_job(job_id: str) -> BuildJobResponse:
        try:
            job = await build_jobs.retry(job_id)
        except BuildJobNotFoundError as error:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=str(error),
            ) from error
        except BuildJobConflict as error:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=str(error),
            ) from error
        return _build_job_response(job)

    @router.post(
        "/v1/avatar/jobs/{job_id}/cleanup",
        response_model=BuildJobResponse,
    )
    async def cleanup_build_job(job_id: str) -> BuildJobResponse:
        try:
            job = await build_jobs.cleanup(job_id)
        except BuildJobNotFoundError as error:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=str(error),
            ) from error
        except BuildJobConflict as error:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=str(error),
            ) from error
        return _build_job_response(job)

    @router.get(
        "/v1/avatar/humans",
        response_model=DigitalHumanListResponse,
    )
    async def list_humans(
        limit: int = Query(default=100, ge=1, le=200),
        offset: int = Query(default=0, ge=0),
    ) -> DigitalHumanListResponse:
        humans = await digital_humans.list(limit=limit + 1, offset=offset)
        total = await digital_humans.count()
        has_more = len(humans) > limit
        return DigitalHumanListResponse(
            humans=tuple(_human_response(human) for human in humans[:limit]),
            total=total,
            has_more=has_more,
        )

    @router.get(
        "/v1/avatar/humans/default",
        response_model=DigitalHumanResponse | None,
    )
    async def default_human() -> DigitalHumanResponse | None:
        human = await digital_humans.get_default()
        return None if human is None else _human_response(human)

    @router.get(
        "/v1/avatar/humans/{human_id}",
        response_model=DigitalHumanResponse,
    )
    async def get_human(human_id: str) -> DigitalHumanResponse:
        try:
            human = await digital_humans.get(human_id)
        except DigitalHumanNotFoundError as error:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=str(error),
            ) from error
        return _human_response(human)

    @router.get(
        "/v1/avatar/humans/{human_id}/job",
        response_model=BuildJobResponse | None,
    )
    async def latest_human_job(human_id: str) -> BuildJobResponse | None:
        try:
            await digital_humans.get(human_id)
        except DigitalHumanNotFoundError as error:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=str(error),
            ) from error
        job = await build_jobs.latest_for_digital_human(human_id)
        return None if job is None else _build_job_response(job)

    @router.get(
        "/v1/avatar/humans/{human_id}/jobs",
        response_model=BuildJobHistoryResponse,
    )
    async def list_human_jobs(
        human_id: str,
        limit: int = Query(default=50, ge=1, le=200),
        offset: int = Query(default=0, ge=0),
    ) -> BuildJobHistoryResponse:
        try:
            await digital_humans.get(human_id)
        except DigitalHumanNotFoundError as error:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=str(error),
            ) from error
        jobs = await build_jobs.list_for_digital_human(
            human_id, limit=limit + 1, offset=offset
        )
        has_more = len(jobs) > limit
        return BuildJobHistoryResponse(
            jobs=tuple(
                _build_job_response(job) for job in jobs[:limit]
            ),
            has_more=has_more,
        )

    @router.put(
        "/v1/avatar/humans/{human_id}/default",
        response_model=DigitalHumanResponse,
    )
    async def set_default_human(human_id: str) -> DigitalHumanResponse:
        try:
            human = await digital_humans.set_default(human_id)
        except DigitalHumanNotFoundError as error:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=str(error),
            ) from error
        return _human_response(human)

    @router.put(
        "/v1/avatar/humans/{human_id}/name",
        response_model=DigitalHumanResponse,
    )
    async def rename_human(
        human_id: str,
        payload: RenameDigitalHumanRequest,
    ) -> DigitalHumanResponse:
        try:
            human = await digital_humans.rename(
                human_id, name=payload.name
            )
        except DigitalHumanNotFoundError as error:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=str(error),
            ) from error
        except ValueError as error:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=str(error),
            ) from error
        return _human_response(human)

    @router.delete(
        "/v1/avatar/humans/{human_id}",
        status_code=status.HTTP_204_NO_CONTENT,
    )
    async def delete_human(human_id: str) -> Response:
        try:
            human = await digital_humans.get(human_id)
        except DigitalHumanNotFoundError as error:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=str(error),
            ) from error
        # Honest delete: never delete local record while remote resources are
        # still pending cleanup. If a build job tracked remote resources whose
        # cleanup is pending/failed/not-attempted, refuse to delete so the
        # record stays recoverable instead of pretending cleanup succeeded.
        if _has_remote_resources(human):
            job = await build_jobs.latest_for_digital_human(human_id)
            if job is None:
                # No tracked build job backs the remote resources; there is no
                # cleanup interface to gate on, so a local-only delete is honest.
                pass
            elif job.cleanup_state is not CleanupState.SUCCEEDED:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=(
                        "remote cleanup is required before deleting the local "
                        f"record (cleanup_state={job.cleanup_state.value})"
                    ),
                )
        await digital_humans.delete(human_id)
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @router.post(
        "/v1/avatar/streams",
        response_model=AvatarStreamStartResponse,
    )
    async def start_stream(
        payload: AvatarStreamStartRequest,
    ) -> AvatarStreamStartResponse:
        if stream_client is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="avatar stream service is not configured",
            )
        try:
            stream = await stream_client.start_avatar_stream(
                avatar_id=payload.avatar_id,
                voice_id=payload.voice_id,
            )
        except Exception as error:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=str(error),
            ) from error
        return AvatarStreamStartResponse(
            session_id=stream.session_id,
            stream_url=stream.stream_url,
        )

    @router.delete(
        "/v1/avatar/streams/{session_id}",
        status_code=status.HTTP_204_NO_CONTENT,
    )
    async def stop_stream(session_id: str) -> Response:
        if stream_client is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="avatar stream service is not configured",
            )
        try:
            await stream_client.stop_avatar_stream(session_id=session_id)
        except Exception as error:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=str(error),
            ) from error
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    return router


def _build_job_response(job: BuildJob) -> BuildJobResponse:
    return BuildJobResponse(
        id=job.id,
        status=job.status.value,
        current_stage=job.current_stage.value,
        stage_progress=job.stage_progress,
        succeeded_stages=tuple(stage.value for stage in job.succeeded_stages),
        retry_count=job.retry_count,
        error_code=job.error_code,
        error_detail=job.error_detail,
        cancelled=job.cancelled,
        digital_human_id=job.digital_human_id,
        mode=job.mode,
        provider=job.provider,
        remote_resource_id=job.remote_resource_id,
        cleanup_state=job.cleanup_state.value,
        last_error=job.last_error,
        created_at=job.created_at.isoformat(),
        updated_at=job.updated_at.isoformat(),
        completed_at=(
            job.completed_at.isoformat() if job.completed_at else None
        ),
    )


def _has_remote_resources(human: DigitalHuman) -> bool:
    return bool(
        human.voice_id
        or human.avatar_id
        or (human.remote_status is not None and human.remote_status.strip() != "")
    )


def _human_response(human: DigitalHuman) -> DigitalHumanResponse:
    return DigitalHumanResponse(
        id=human.id,
        name=human.name,
        voice_provider_id=human.voice_provider_id,
        avatar_provider_id=human.avatar_provider_id,
        voice_id=human.voice_id,
        avatar_id=human.avatar_id,
        creation_status=human.creation_status.value,
        creation_progress=human.creation_progress,
        is_default=human.is_default,
        error=human.error,
        portrait_path=human.portrait_path,
        recording_path=human.recording_path,
        remote_status=human.remote_status,
        created_at=human.created_at.isoformat(),
        updated_at=human.updated_at.isoformat(),
    )