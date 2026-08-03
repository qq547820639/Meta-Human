from datetime import datetime
from typing import Protocol

from fastapi import APIRouter, Depends, Response, status
from pydantic import BaseModel, ConfigDict

from voxstudio_core.persistence.readiness_repository import (
    PersistedCapability,
    PersistedReadinessRun,
)
from voxstudio_core.readiness.models import (
    AggregateState,
    CapabilityId,
    CapabilityReadiness,
    CapabilityState,
    OutcomeReadiness,
    gate_open,
    group_outcomes,
)
from voxstudio_core.security import BearerTokenGuard


class ReadinessRunNotFoundError(LookupError):
    pass


class ReadinessLifecyclePort(Protocol):
    async def current_run(self) -> PersistedReadinessRun | None: ...

    async def start_or_resume(self) -> PersistedReadinessRun: ...


class CapabilityErrorSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    code: str
    message: str
    retryable: bool
    recommended_action: str | None = None


class CapabilitySnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    id: CapabilityId
    required: bool
    state: CapabilityState
    attempts: int
    safe_detail: str | None
    error: CapabilityErrorSnapshot | None
    created_at: datetime
    updated_at: datetime


class ReadinessSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str | None
    state: AggregateState
    gate_open: bool
    outcomes: tuple[OutcomeReadiness, ...]
    capabilities: tuple[CapabilitySnapshot, ...]
    created_at: datetime | None
    updated_at: datetime | None
    completed_at: datetime | None


def create_readiness_router(
    *,
    guard: BearerTokenGuard,
    lifecycle: ReadinessLifecyclePort,
) -> APIRouter:
    router = APIRouter(dependencies=[Depends(guard)])

    @router.get(
        "/readyz",
        response_model=ReadinessSnapshot,
        responses={
            status.HTTP_503_SERVICE_UNAVAILABLE: {
                "model": ReadinessSnapshot,
            }
        },
    )
    async def readyz(response: Response) -> ReadinessSnapshot:
        snapshot = snapshot_from_run(await lifecycle.current_run())
        if not snapshot.gate_open:
            response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return snapshot

    @router.post(
        "/v1/readiness/runs",
        response_model=ReadinessSnapshot,
        status_code=status.HTTP_202_ACCEPTED,
    )
    async def start_or_resume() -> ReadinessSnapshot:
        return snapshot_from_run(await lifecycle.start_or_resume())

    @router.get(
        "/v1/readiness/runs/current",
        response_model=ReadinessSnapshot,
    )
    async def current() -> ReadinessSnapshot:
        run = await lifecycle.current_run()
        if run is None:
            raise ReadinessRunNotFoundError
        return snapshot_from_run(run)

    return router


def snapshot_from_run(
    run: PersistedReadinessRun | None,
) -> ReadinessSnapshot:
    if run is None:
        return ReadinessSnapshot(
            id=None,
            state=AggregateState.NOT_STARTED,
            gate_open=False,
            outcomes=group_outcomes(()),
            capabilities=(),
            created_at=None,
            updated_at=None,
            completed_at=None,
        )

    readiness = tuple(
        CapabilityReadiness(
            id=capability.id,
            required=capability.required,
            state=capability.state,
        )
        for capability in run.capabilities
    )
    return ReadinessSnapshot(
        id=run.id,
        state=run.state,
        gate_open=gate_open(readiness),
        outcomes=group_outcomes(readiness),
        capabilities=tuple(
            _capability_snapshot(capability)
            for capability in run.capabilities
        ),
        created_at=run.created_at,
        updated_at=run.updated_at,
        completed_at=run.completed_at,
    )


def _capability_snapshot(
    capability: PersistedCapability,
) -> CapabilitySnapshot:
    error = capability.error
    return CapabilitySnapshot(
        id=capability.id,
        required=capability.required,
        state=capability.state,
        attempts=capability.attempts,
        safe_detail=capability.safe_detail,
        error=(
            None
            if error is None
            else CapabilityErrorSnapshot(
                code=error.code,
                message=error.message,
                retryable=error.retryable,
                recommended_action=error.recommended_action,
            )
        ),
        created_at=capability.created_at,
        updated_at=capability.updated_at,
    )

