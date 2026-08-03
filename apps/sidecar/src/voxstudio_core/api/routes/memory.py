from fastapi import APIRouter, Depends, HTTPException, Query, status

from voxstudio_core.knowledge.memory import MemoryService
from voxstudio_core.persistence.memory_entry_repository import (
    MemoryEntryNotFoundError,
)
from voxstudio_core.security import BearerTokenGuard
from pydantic import BaseModel, ConfigDict, Field


class MemoryEntryOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    type: str
    content: str
    source_message_id: str | None
    confidence: float | None
    created_at: str
    updated_at: str
    last_used_at: str | None
    confirmed_by_user: bool
    sensitive: bool
    expires_at: str | None
    conflict_group: str | None


class MemoryEntryListResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    entries: tuple[MemoryEntryOut, ...]
    total: int


class MemoryEntryPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    content: str | None = Field(default=None, min_length=1, max_length=2_000)
    confirmed: bool | None = None
    sensitive: bool | None = None
    reject: bool | None = None


class MemoryClearResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    cleared: bool = True


class MemorySettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool


def create_memory_router(
    *,
    guard: BearerTokenGuard,
    memory_service: MemoryService,
) -> APIRouter:
    router = APIRouter(dependencies=[Depends(guard)])

    @router.get(
        "/v1/memory/entries",
        response_model=MemoryEntryListResponse,
    )
    async def list_entries(
        type: str | None = Query(default=None),
    ) -> MemoryEntryListResponse:
        entries = await memory_service.list_entries(type=type)
        return MemoryEntryListResponse(
            entries=tuple(_entry_out(entry) for entry in entries),
            total=len(entries),
        )

    @router.get(
        "/v1/memory/entries/{entry_id}",
        response_model=MemoryEntryOut,
    )
    async def get_entry(entry_id: str) -> MemoryEntryOut:
        try:
            entry = await memory_service.get_entry(entry_id)
        except MemoryEntryNotFoundError as error:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=str(error),
            ) from error
        return _entry_out(entry)

    @router.patch(
        "/v1/memory/entries/{entry_id}",
        response_model=MemoryEntryOut,
    )
    async def patch_entry(
        entry_id: str,
        payload: MemoryEntryPatch,
    ) -> MemoryEntryOut:
        try:
            entry = await memory_service.get_entry(entry_id)
            if payload.reject:
                await memory_service.delete_entry(entry_id)
                return _entry_out(entry)
            if payload.content is not None:
                entry = await memory_service.update_entry_content(
                    entry_id,
                    content=payload.content,
                )
            if payload.confirmed is not None:
                entry = await memory_service.set_entry_confirmed(
                    entry_id,
                    confirmed=payload.confirmed,
                )
            if payload.sensitive is not None:
                entry = await memory_service.set_entry_sensitive(
                    entry_id,
                    sensitive=payload.sensitive,
                )
            return _entry_out(entry)
        except MemoryEntryNotFoundError as error:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=str(error),
            ) from error

    @router.delete(
        "/v1/memory/entries/{entry_id}",
        response_model=MemoryEntryOut,
    )
    async def delete_entry(entry_id: str) -> MemoryEntryOut:
        try:
            entry = await memory_service.get_entry(entry_id)
            await memory_service.delete_entry(entry_id)
        except MemoryEntryNotFoundError as error:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=str(error),
            ) from error
        return _entry_out(entry)

    @router.delete(
        "/v1/memory/entries",
        response_model=MemoryClearResponse,
    )
    async def delete_all_entries() -> MemoryClearResponse:
        await memory_service.clear_entries()
        return MemoryClearResponse()

    @router.post(
        "/v1/memory/clear",
        response_model=MemoryClearResponse,
    )
    async def clear_entries() -> MemoryClearResponse:
        await memory_service.clear_entries()
        return MemoryClearResponse()

    @router.get(
        "/v1/memory/settings",
        response_model=MemorySettings,
    )
    async def memory_settings() -> MemorySettings:
        return MemorySettings(enabled=memory_service.enabled)

    @router.put(
        "/v1/memory/settings",
        response_model=MemorySettings,
    )
    async def update_memory_settings(
        payload: MemorySettings,
    ) -> MemorySettings:
        memory_service.set_enabled(payload.enabled)
        return MemorySettings(enabled=memory_service.enabled)

    return router


def _entry_out(entry) -> MemoryEntryOut:
    return MemoryEntryOut(
        id=entry.id,
        type=entry.type,
        content=entry.content,
        source_message_id=entry.source_message_id,
        confidence=entry.confidence,
        created_at=entry.created_at,
        updated_at=entry.updated_at,
        last_used_at=entry.last_used_at,
        confirmed_by_user=entry.confirmed_by_user,
        sensitive=entry.sensitive,
        expires_at=entry.expires_at,
        conflict_group=entry.conflict_group,
    )