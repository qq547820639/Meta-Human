import asyncio
import json
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

from voxstudio_core.knowledge.conversation import (
    ConversationService,
    ConversationUnavailableError,
    MemoryUnavailableError,
    TranscriptionUnavailableError,
)
from voxstudio_core.persistence.conversation_repository import (
    ConversationNotFoundError,
)
from voxstudio_core.security import BearerTokenGuard


class ReplyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    query: str = Field(min_length=1, max_length=2_000)
    regenerate: bool = False
    conversation_id: str | None = None


class ReplyResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str
    citations: tuple[str, ...]
    grounded: bool
    audio_base64: str | None = None
    citation_urls: tuple[str | None, ...] = ()
    used_source_ids: tuple[str, ...] = ()
    confidence: float | None = None
    insufficient_context: bool = False
    suggested_follow_up: str | None = None


class StopRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    generation_id: str = Field(min_length=1)


class StopResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    stopped: bool


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


class SourceMessageOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    found: bool
    role: str | None = None
    content: str | None = None
    created_at: str | None = None


class ConversationCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, max_length=200)
    avatar_id: str | None = None


class ConversationOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    title: str
    avatar_id: str | None
    created_at: str
    updated_at: str
    last_message_at: str | None
    archived: bool
    deleted: bool
    summary: str | None
    is_temporary: bool = False


class ConversationRename(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=200)


class ConversationArchive(BaseModel):
    model_config = ConfigDict(extra="forbid")

    archived: bool = True


class ConversationTemporary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    temporary: bool = True


class ConversationListResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    conversations: tuple[ConversationOut, ...]
    total: int
    has_more: bool = False


class ConversationMessagesResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    messages: tuple[HistoryMessage, ...]
    next_cursor: str | None = None
    has_more: bool = False


class ConversationExport(BaseModel):
    model_config = ConfigDict(extra="forbid")

    conversation: ConversationOut
    messages: tuple[HistoryMessage, ...]


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
            conversation_id=payload.conversation_id,
        )
        return ReplyResponse(
            text=result.text,
            citations=result.citations,
            grounded=result.grounded,
            audio_base64=result.audio_base64,
            citation_urls=result.citation_urls,
            used_source_ids=result.used_source_ids,
            confidence=result.confidence,
            insufficient_context=result.insufficient_context,
            suggested_follow_up=result.suggested_follow_up,
        )

    @router.post(
        "/v1/conversation/replies/stream",
    )
    async def reply_stream(payload: ReplyRequest) -> StreamingResponse:
        generation_id = service.create_generation()

        async def event_stream():
            try:
                async for event in service.stream_reply(
                    query=payload.query,
                    regenerate=payload.regenerate,
                    conversation_id=payload.conversation_id,
                    generation_id=generation_id,
                ):
                    yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
            except asyncio.CancelledError:
                raise
            finally:
                service.unregister_generation(generation_id)

        return StreamingResponse(
            event_stream(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
            },
        )

    @router.post(
        "/v1/conversation/replies/stop",
        response_model=StopResponse,
    )
    async def stop_reply(payload: StopRequest) -> StopResponse:
        stopped = service.stop_generation(payload.generation_id)
        return StopResponse(stopped=stopped)

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

    @router.get(
        "/v1/conversation/messages/{message_id}",
        response_model=SourceMessageOut,
    )
    async def get_source_message(message_id: int) -> SourceMessageOut:
        message = await service.get_source_message(message_id)
        if message is None:
            return SourceMessageOut(found=False)
        return SourceMessageOut(
            found=True,
            role=message.role,
            content=message.content,
            created_at=message.created_at,
        )

    @router.delete(
        "/v1/conversation/history",
        response_model=ClearHistoryResponse,
    )
    async def clear_history() -> ClearHistoryResponse:
        await service.clear_history()
        return ClearHistoryResponse()

    # --- conversation management -------------------------------------------

    @router.post(
        "/v1/conversations",
        response_model=ConversationOut,
    )
    async def create_conversation(
        payload: ConversationCreate,
    ) -> ConversationOut:
        try:
            conversation = await service.create_conversation(
                title=payload.title,
                avatar_id=payload.avatar_id,
            )
        except ConversationUnavailableError as error:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=str(error),
            ) from error
        return _conversation_out(conversation)

    @router.get(
        "/v1/conversations",
        response_model=ConversationListResponse,
    )
    async def list_conversations(
        limit: int = Query(default=50, ge=1, le=200),
        offset: int = Query(default=0, ge=0),
        archived: Literal["any", "active", "archived"] = Query(default="any"),
    ) -> ConversationListResponse:
        try:
            conversations = await service.list_conversations(
                limit=limit + 1,
                offset=offset,
                archived=archived,
            )
            total = await service.count_conversations(archived=archived)
        except ConversationUnavailableError as error:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=str(error),
            ) from error
        has_more = len(conversations) > limit
        return ConversationListResponse(
            conversations=tuple(
                _conversation_out(conversation)
                for conversation in conversations[:limit]
            ),
            total=total,
            has_more=has_more,
        )

    @router.get(
        "/v1/conversations/search",
        response_model=ConversationListResponse,
    )
    async def search_conversations(
        q: str = Query(min_length=1, max_length=200),
        limit: int = Query(default=50, ge=1, le=200),
        offset: int = Query(default=0, ge=0),
    ) -> ConversationListResponse:
        try:
            conversations = await service.search_conversations(
                query=q,
                limit=limit + 1,
                offset=offset,
            )
        except ConversationUnavailableError as error:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=str(error),
            ) from error
        has_more = len(conversations) > limit
        return ConversationListResponse(
            conversations=tuple(
                _conversation_out(conversation)
                for conversation in conversations[:limit]
            ),
            total=len(conversations[:limit]),
            has_more=has_more,
        )

    @router.get(
        "/v1/conversations/{conversation_id}",
        response_model=ConversationOut,
    )
    async def get_conversation(
        conversation_id: str,
    ) -> ConversationOut:
        try:
            conversation = await service.get_conversation(conversation_id)
        except ConversationNotFoundError as error:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=str(error),
            ) from error
        except ConversationUnavailableError as error:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=str(error),
            ) from error
        return _conversation_out(conversation)

    @router.get(
        "/v1/conversations/{conversation_id}/messages",
        response_model=ConversationMessagesResponse,
    )
    async def list_conversation_messages(
        conversation_id: str,
        limit: int = Query(default=50, ge=1, le=200),
        cursor: str | None = Query(default=None),
    ) -> ConversationMessagesResponse:
        try:
            messages, next_cursor, has_more = (
                await service.list_conversation_messages(
                    conversation_id=conversation_id,
                    limit=limit,
                    cursor=cursor,
                )
            )
        except ConversationNotFoundError as error:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=str(error),
            ) from error
        except ConversationUnavailableError as error:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=str(error),
            ) from error
        return ConversationMessagesResponse(
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
            ),
            next_cursor=next_cursor,
            has_more=has_more,
        )

    @router.patch(
        "/v1/conversations/{conversation_id}",
        response_model=ConversationOut,
    )
    async def rename_conversation(
        conversation_id: str,
        payload: ConversationRename,
    ) -> ConversationOut:
        try:
            conversation = await service.rename_conversation(
                conversation_id,
                title=payload.title,
            )
        except ConversationNotFoundError as error:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=str(error),
            ) from error
        except ConversationUnavailableError as error:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=str(error),
            ) from error
        return _conversation_out(conversation)

    @router.delete(
        "/v1/conversations/{conversation_id}",
        response_model=ClearHistoryResponse,
    )
    async def delete_conversation(
        conversation_id: str,
    ) -> ClearHistoryResponse:
        try:
            await service.delete_conversation(conversation_id)
        except ConversationNotFoundError as error:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=str(error),
            ) from error
        except ConversationUnavailableError as error:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=str(error),
            ) from error
        return ClearHistoryResponse()

    @router.post(
        "/v1/conversations/{conversation_id}/archive",
        response_model=ConversationOut,
    )
    async def archive_conversation(
        conversation_id: str,
        payload: ConversationArchive | None = None,
    ) -> ConversationOut:
        archived = payload.archived if payload is not None else True
        try:
            conversation = await service.archive_conversation(
                conversation_id,
                archived=archived,
            )
        except ConversationNotFoundError as error:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=str(error),
            ) from error
        except ConversationUnavailableError as error:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=str(error),
            ) from error
        return _conversation_out(conversation)

    @router.post(
        "/v1/conversations/{conversation_id}/temporary",
        response_model=ConversationOut,
    )
    async def set_temporary_conversation(
        conversation_id: str,
        payload: ConversationTemporary,
    ) -> ConversationOut:
        try:
            conversation = await service.set_temporary_conversation(
                conversation_id,
                is_temporary=payload.temporary,
            )
        except ConversationNotFoundError as error:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=str(error),
            ) from error
        except ConversationUnavailableError as error:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=str(error),
            ) from error
        return _conversation_out(conversation)

    @router.post(
        "/v1/conversations/{conversation_id}/clear",
        response_model=ClearHistoryResponse,
    )
    async def clear_conversation(
        conversation_id: str,
    ) -> ClearHistoryResponse:
        try:
            await service.clear_conversation(conversation_id)
        except ConversationNotFoundError as error:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=str(error),
            ) from error
        except ConversationUnavailableError as error:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=str(error),
            ) from error
        return ClearHistoryResponse()

    @router.get(
        "/v1/conversations/{conversation_id}/export",
        response_model=ConversationExport,
    )
    async def export_conversation(
        conversation_id: str,
    ) -> ConversationExport:
        try:
            exported = await service.export_conversation(conversation_id)
        except ConversationNotFoundError as error:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=str(error),
            ) from error
        except ConversationUnavailableError as error:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=str(error),
            ) from error
        conversation = exported["conversation"]
        return ConversationExport(
            conversation=_conversation_out(conversation),
            messages=tuple(
                HistoryMessage(
                    role=message["role"],
                    content=message["content"],
                    citations=message["citations"],
                    citation_urls=message["citation_urls"],
                    grounded=message["grounded"],
                    created_at=message["created_at"],
                )
                for message in exported["messages"]
            ),
        )

    return router


def _conversation_out(conversation) -> ConversationOut:
    return ConversationOut(
        id=conversation.id,
        title=conversation.title,
        avatar_id=conversation.avatar_id,
        created_at=conversation.created_at,
        updated_at=conversation.updated_at,
        last_message_at=conversation.last_message_at,
        archived=conversation.archived,
        deleted=conversation.deleted,
        summary=conversation.summary,
        is_temporary=conversation.is_temporary,
    )
