from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, ConfigDict, Field

from voxstudio_core.persistence.build_job_repository import (
    BuildJob,
    BuildJobNotFoundError,
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
    created_at: str
    updated_at: str
    completed_at: str | None = None


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
        response_model=tuple[DigitalHumanResponse, ...],
    )
    async def list_humans() -> tuple[DigitalHumanResponse, ...]:
        humans = await digital_humans.list()
        return tuple(_human_response(human) for human in humans)

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
            await digital_humans.delete(human_id)
        except DigitalHumanNotFoundError as error:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=str(error),
            ) from error
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
        created_at=job.created_at.isoformat(),
        updated_at=job.updated_at.isoformat(),
        completed_at=(
            job.completed_at.isoformat() if job.completed_at else None
        ),
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