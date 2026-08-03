from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, ConfigDict, Field

from voxstudio_core.providers.avatar_build import (
    AvatarBuildService,
    AvatarBuildUnavailableError,
)
from voxstudio_core.providers.remote_gpu import RemoteGpuClient
from voxstudio_core.security import BearerTokenGuard


class AvatarBuildRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    portrait_path: str = Field(min_length=1)
    recording_path: str = Field(min_length=1)


class AvatarBuildResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    voice_id: str
    avatar_id: str


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
    service: AvatarBuildService,
    stream_client: RemoteGpuClient | None = None,
) -> APIRouter:
    router = APIRouter(dependencies=[Depends(guard)])

    @router.post(
        "/v1/avatar/builds",
        response_model=AvatarBuildResponse,
    )
    async def build(payload: AvatarBuildRequest) -> AvatarBuildResponse:
        try:
            result = await service.build(
                portrait_path=payload.portrait_path,
                recording_path=payload.recording_path,
            )
        except AvatarBuildUnavailableError as error:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=str(error),
            ) from error
        return AvatarBuildResponse(
            voice_id=result.voice_id,
            avatar_id=result.avatar_id,
        )

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
