from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field

from voxstudio_core.knowledge.conversation import (
    ConversationService,
    MemoryUnavailableError,
    TranscriptionUnavailableError,
)
from voxstudio_core.security import BearerTokenGuard


class ReplyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    query: str = Field(min_length=1, max_length=2_000)
    regenerate: bool = False


class ReplyResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str
    citations: tuple[str, ...]
    grounded: bool
    audio_base64: str | None = None
    citation_urls: tuple[str | None, ...] = ()


class HistoryMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: str
    content: str
    citations: tuple[str, ...] = ()
    citation_urls: tuple[str | None, ...] = ()
    grounded: bool = False
    created_at: str | None = None


class HistoryResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    messages: tuple[HistoryMessage, ...]


class ClearHistoryResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    cleared: bool = True


class TranscribeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    audio_path: str = Field(min_length=1)


class TranscribeResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str


class MemoryResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    summary: str
    created_at: str | None = None


class MemoryUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    summary: str = Field(min_length=1, max_length=2_000)


class MemoryClearResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    cleared: bool = True


def create_conversation_router(
    *,
    guard: BearerTokenGuard,
    service: ConversationService,
) -> APIRouter:
    router = APIRouter(dependencies=[Depends(guard)])

    @router.post(
        "/v1/conversation/replies",
        response_model=ReplyResponse,
    )
    async def reply(payload: ReplyRequest) -> ReplyResponse:
        result = await service.reply(
            query=payload.query,
            regenerate=payload.regenerate,
        )
        return ReplyResponse(
            text=result.text,
            citations=result.citations,
            grounded=result.grounded,
            audio_base64=result.audio_base64,
            citation_urls=result.citation_urls,
        )

    @router.post(
        "/v1/conversation/transcribe",
        response_model=TranscribeResponse,
    )
    async def transcribe(
        payload: TranscribeRequest,
    ) -> TranscribeResponse:
        try:
            text = await service.transcribe(audio_path=payload.audio_path)
        except TranscriptionUnavailableError as error:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=str(error),
            ) from error
        if not text.strip():
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="transcription was empty",
            )
        return TranscribeResponse(text=text)

    @router.get(
        "/v1/conversation/history",
        response_model=HistoryResponse,
    )
    async def history() -> HistoryResponse:
        messages = await service.recent_history()
        return HistoryResponse(
            messages=tuple(
                HistoryMessage(
                    role=message.role,
                    content=message.content,
                    citations=message.citations,
                    citation_urls=message.citation_urls,
                    grounded=message.grounded,
                    created_at=message.created_at,
                )
                for message in messages
            )
        )

    @router.get(
        "/v1/conversation/memory",
        response_model=MemoryResponse | None,
    )
    async def memory() -> MemoryResponse | None:
        current = await service.current_memory()
        if current is None:
            return None
        return MemoryResponse(
            summary=current.summary,
            created_at=current.created_at,
        )

    @router.put(
        "/v1/conversation/memory",
        response_model=MemoryResponse,
    )
    async def update_memory(
        payload: MemoryUpdateRequest,
    ) -> MemoryResponse:
        try:
            await service.update_memory(summary=payload.summary)
        except MemoryUnavailableError as error:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=str(error),
            ) from error
        current = await service.current_memory()
        assert current is not None
        return MemoryResponse(
            summary=current.summary,
            created_at=current.created_at,
        )

    @router.delete(
        "/v1/conversation/memory",
        response_model=MemoryClearResponse,
    )
    async def clear_memory() -> MemoryClearResponse:
        try:
            await service.clear_memory()
        except MemoryUnavailableError as error:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=str(error),
            ) from error
        return MemoryClearResponse()

    @router.delete(
        "/v1/conversation/history",
        response_model=ClearHistoryResponse,
    )
    async def clear_history() -> ClearHistoryResponse:
        await service.clear_history()
        return ClearHistoryResponse()

    return router
