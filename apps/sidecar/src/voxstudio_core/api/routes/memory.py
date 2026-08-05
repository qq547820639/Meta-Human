from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field

from voxstudio_core.knowledge.memory import MemoryService
from voxstudio_core.persistence.memory_entry_repository import (
    MemoryEntryNotFoundError,
    MemoryIgnoreRuleNotFoundError,
)
from voxstudio_core.security import BearerTokenGuard


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
    source: str
    scope: str
    scope_id: str | None
    pinned: bool
    disabled: bool


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
    pinned: bool | None = None
    disabled: bool | None = None


class MemoryIgnoreRuleOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    type: str
    scope: str
    scope_id: str | None
    created_at: str


class MemoryIgnoreRuleCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: str = Field(min_length=1, max_length=64)
    scope: str = "global"
    scope_id: str | None = None


class MemoryIgnoreRuleListResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rules: tuple[MemoryIgnoreRuleOut, ...]
    total: int


class MemoryPermanentDeleteResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    deleted: bool = True
    verified: bool


class MemoryPrivacyResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    statement: str


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
        source: str | None = Query(default=None),
        scope: str | None = Query(default=None),
        scope_id: str | None = Query(default=None),
    ) -> MemoryEntryListResponse:
        entries = await memory_service.list_entries(
            type=type,
            source=source,
            scope=scope,
            scope_id=scope_id,
        )
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
            if payload.pinned is not None:
                entry = await memory_service.set_entry_pinned(
                    entry_id,
                    pinned=payload.pinned,
                )
            if payload.disabled is not None:
                entry = await memory_service.set_entry_disabled(
                    entry_id,
                    disabled=payload.disabled,
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
        "/v1/memory/entries/{entry_id}/permanent",
        response_model=MemoryPermanentDeleteResponse,
    )
    async def permanent_delete_entry(
        entry_id: str,
    ) -> MemoryPermanentDeleteResponse:
        try:
            verified = await memory_service.permanent_delete(entry_id)
        except MemoryEntryNotFoundError as error:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=str(error),
            ) from error
        return MemoryPermanentDeleteResponse(deleted=True, verified=verified)

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
        "/v1/memory/ignore-rules",
        response_model=MemoryIgnoreRuleListResponse,
    )
    async def list_ignore_rules(
        scope: str | None = Query(default=None),
        scope_id: str | None = Query(default=None),
    ) -> MemoryIgnoreRuleListResponse:
        rules = await memory_service.list_ignore_rules(
            scope=scope, scope_id=scope_id
        )
        return MemoryIgnoreRuleListResponse(
            rules=tuple(_rule_out(rule) for rule in rules),
            total=len(rules),
        )

    @router.post(
        "/v1/memory/ignore-rules",
        response_model=MemoryIgnoreRuleOut,
    )
    async def create_ignore_rule(
        payload: MemoryIgnoreRuleCreate,
    ) -> MemoryIgnoreRuleOut:
        rule = await memory_service.ignore_memory_type(
            type=payload.type,
            scope=payload.scope,
            scope_id=payload.scope_id,
        )
        return _rule_out(rule)

    @router.delete(
        "/v1/memory/ignore-rules/{rule_id}",
        response_model=MemoryIgnoreRuleOut,
    )
    async def delete_ignore_rule(rule_id: str) -> MemoryIgnoreRuleOut:
        rules = await memory_service.list_ignore_rules()
        target = next((rule for rule in rules if rule.id == rule_id), None)
        try:
            await memory_service.unignore_memory_type(rule_id)
        except MemoryIgnoreRuleNotFoundError as error:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=str(error),
            ) from error
        if target is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"ignore rule not found: {rule_id}",
            )
        return _rule_out(target)

    @router.get(
        "/v1/memory/privacy",
        response_model=MemoryPrivacyResponse,
    )
    async def memory_privacy() -> MemoryPrivacyResponse:
        return MemoryPrivacyResponse(statement=memory_service.privacy_statement())

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
        source=entry.source,
        scope=entry.scope,
        scope_id=entry.scope_id,
        pinned=entry.pinned,
        disabled=entry.disabled,
    )


def _rule_out(rule) -> MemoryIgnoreRuleOut:
    return MemoryIgnoreRuleOut(
        id=rule.id,
        type=rule.type,
        scope=rule.scope,
        scope_id=rule.scope_id,
        created_at=rule.created_at,
    )
