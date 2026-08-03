from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict

from voxstudio_core.persistence.database import Database
from voxstudio_core.security import BearerTokenGuard


class PrivacyClearResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    cleared: bool = True


def create_privacy_router(
    *,
    guard: BearerTokenGuard,
    database: Database,
) -> APIRouter:
    router = APIRouter(dependencies=[Depends(guard)])

    @router.delete(
        "/v1/privacy/data",
        response_model=PrivacyClearResponse,
    )
    async def clear_local_data() -> PrivacyClearResponse:
        async with database.transaction() as connection:
            await connection.execute("DELETE FROM conversation_messages")
            await connection.execute("DELETE FROM conversation_memory")
            await connection.execute("DELETE FROM knowledge_chunks")
            await connection.execute("DELETE FROM knowledge_documents")
        return PrivacyClearResponse()

    return router
