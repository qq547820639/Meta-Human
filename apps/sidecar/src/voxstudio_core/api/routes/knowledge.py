from fastapi import APIRouter, Depends, Response, status
from pydantic import BaseModel, ConfigDict

from voxstudio_core.knowledge.sources import KnowledgeSourceStore
from voxstudio_core.security import BearerTokenGuard


class KnowledgeSourceResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    document_id: str
    title: str
    source_url: str | None = None
    synced_at: str | None = None
    chunk_count: int


class KnowledgeSourceListResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sources: tuple[KnowledgeSourceResponse, ...]


def create_knowledge_router(
    *,
    guard: BearerTokenGuard,
    store: KnowledgeSourceStore,
) -> APIRouter:
    router = APIRouter(dependencies=[Depends(guard)])

    @router.get(
        "/v1/knowledge/sources",
        response_model=KnowledgeSourceListResponse,
    )
    async def list_sources() -> KnowledgeSourceListResponse:
        sources = await store.list_sources()
        return KnowledgeSourceListResponse(
            sources=tuple(
                KnowledgeSourceResponse(
                    document_id=source.document_id,
                    title=source.title,
                    source_url=source.source_url,
                    synced_at=source.synced_at,
                    chunk_count=source.chunk_count,
                )
                for source in sources
            )
        )

    @router.delete(
        "/v1/knowledge/sources/{document_id}",
        status_code=status.HTTP_204_NO_CONTENT,
    )
    async def delete_source(document_id: str) -> Response:
        await store.delete_source(document_id=document_id)
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    return router
