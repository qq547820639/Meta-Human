from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, ConfigDict, Field

from voxstudio_core.knowledge.sources import KnowledgeSourceStore
from voxstudio_core.knowledge.sync import KnowledgeSyncService
from voxstudio_core.security import BearerTokenGuard


class KnowledgeSourceResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    document_id: str
    title: str
    source_url: str | None = None
    synced_at: str | None = None
    chunk_count: int
    enabled: bool = True
    status: str = "ready"
    freshness: str = "never"
    sync_progress: float = 0.0
    sync_stage: str | None = None
    last_error: str | None = None


class KnowledgeSourceListResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sources: tuple[KnowledgeSourceResponse, ...]
    total: int = 0
    has_more: bool = False


class KnowledgeSourceUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool


class KnowledgeSourceResyncResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    document_id: str
    status: str
    enabled: bool
    sync_progress: float = 0.0
    sync_stage: str | None = None
    last_error: str | None = None


def _to_response(source: object) -> KnowledgeSourceResponse:
    return KnowledgeSourceResponse(
        document_id=source.document_id,
        title=source.title,
        source_url=source.source_url,
        synced_at=source.synced_at,
        chunk_count=source.chunk_count,
        enabled=source.enabled,
        status=source.status,
        freshness=source.freshness,
        sync_progress=source.sync_progress,
        sync_stage=source.sync_stage,
        last_error=source.last_error,
    )


def create_knowledge_router(
    *,
    guard: BearerTokenGuard,
    store: KnowledgeSourceStore,
    sync: KnowledgeSyncService | None = None,
) -> APIRouter:
    router = APIRouter(dependencies=[Depends(guard)])

    @router.get(
        "/v1/knowledge/sources",
        response_model=KnowledgeSourceListResponse,
    )
    async def list_sources(
        limit: int = Query(default=100, ge=1, le=200),
        offset: int = Query(default=0, ge=0),
    ) -> KnowledgeSourceListResponse:
        sources = await store.list_sources(limit=limit + 1, offset=offset)
        total = await store.count_sources()
        has_more = len(sources) > limit
        return KnowledgeSourceListResponse(
            sources=tuple(
                _to_response(source) for source in sources[:limit]
            ),
            total=total,
            has_more=has_more,
        )

    @router.patch(
        "/v1/knowledge/sources/{document_id}",
        response_model=KnowledgeSourceResponse,
    )
    async def update_source(
        document_id: str,
        payload: KnowledgeSourceUpdateRequest,
    ) -> KnowledgeSourceResponse:
        if sync is not None:
            state = await sync.set_enabled(
                document_id=document_id,
                enabled=payload.enabled,
            )
            if state is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="知识源不存在",
                )
        else:
            updated = await store.set_enabled(
                document_id=document_id,
                enabled=payload.enabled,
            )
            if not updated:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="知识源不存在",
                )
        source = await store.get_source(document_id=document_id)
        if source is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="知识源不存在",
            )
        return _to_response(source)

    @router.post(
        "/v1/knowledge/sources/{document_id}/resync",
        response_model=KnowledgeSourceResyncResponse,
    )
    async def resync_source(document_id: str) -> KnowledgeSourceResyncResponse:
        if sync is None:
            raise HTTPException(
                status_code=status.HTTP_501_NOT_IMPLEMENTED,
                detail="同步服务未启用",
            )
        state = await sync.resync(document_id=document_id)
        if state is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="知识源不存在",
            )
        return KnowledgeSourceResyncResponse(
            document_id=state.document_id,
            status=state.status.value,
            enabled=state.enabled,
            sync_progress=state.progress,
            sync_stage=state.stage,
            last_error=state.last_error,
        )

    @router.delete(
        "/v1/knowledge/sources/{document_id}",
        status_code=status.HTTP_204_NO_CONTENT,
    )
    async def delete_source(document_id: str) -> Response:
        await store.delete_source(document_id=document_id)
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    return router
