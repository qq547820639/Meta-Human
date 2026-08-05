from __future__ import annotations

import asyncio
import time
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Protocol

from voxstudio_core.capabilities.base import (
    CapabilityActionRequired,
    CapabilityCheckOutcome,
    CapabilityCheckRequest,
    CapabilityReady,
    CapabilityTransientFailure,
)
from voxstudio_core.metrics import (
    OUTCOME_CANCELLED,
    OUTCOME_DEGRADED,
    OUTCOME_ERROR,
    OUTCOME_SUCCESS,
    ProviderMetricsRegistry,
    registry as default_metrics_registry,
)
from voxstudio_core.capabilities.registry import CapabilityAdapterRegistry
from voxstudio_core.persistence.readiness_repository import (
    CapabilityUpdate,
    PersistedReadinessRun,
    SafeError,
)
from voxstudio_core.readiness.models import (
    AggregateState,
    CapabilityId,
    CapabilityReadiness,
    CapabilityState,
    REQUIRED_CAPABILITY_IDS,
    aggregate_state,
)


class ReadinessRepositoryPort(Protocol):
    async def create_or_get_current_run(
        self,
        capabilities: list[CapabilityReadiness]
        | tuple[CapabilityReadiness, ...],
        *,
        run_id: str | None = None,
        created_at: datetime | None = None,
    ) -> PersistedReadinessRun: ...

    async def update_capabilities(
        self,
        run_id: str,
        updates: tuple[CapabilityUpdate, ...] | list[CapabilityUpdate],
        *,
        state: AggregateState,
        updated_at: datetime,
    ) -> PersistedReadinessRun: ...

    async def resume_latest_incomplete_run(
        self,
        *,
        resumed_at: datetime,
    ) -> PersistedReadinessRun | None: ...


class ReadinessService:
    def __init__(
        self,
        repository: ReadinessRepositoryPort,
        registry: CapabilityAdapterRegistry,
        *,
        clock: Callable[[], datetime] | None = None,
        required_capability_ids: frozenset[CapabilityId] | None = None,
        metrics: ProviderMetricsRegistry | None = None,
    ) -> None:
        self._repository = repository
        self._registry = registry
        self._clock = clock or _utc_now
        self._required_capability_ids = (
            required_capability_ids or REQUIRED_CAPABILITY_IDS
        )
        self._metrics = metrics if metrics is not None else default_metrics_registry

    async def prepare(self) -> PersistedReadinessRun:
        started_at = self._clock()
        run = await self._repository.resume_latest_incomplete_run(
            resumed_at=started_at
        )
        if run is None:
            run = await self._repository.create_or_get_current_run(
                _initial_capabilities(self._required_capability_ids),
                created_at=started_at,
            )

        for capability in run.capabilities:
            if (
                not capability.required
                or capability.state is CapabilityState.READY
            ):
                continue

            request = CapabilityCheckRequest(
                capability_id=capability.id,
                attempt=capability.attempts + 1,
            )
            adapter = self._registry.adapter_for(capability.id)
            checking = CapabilityUpdate(
                id=capability.id,
                state=CapabilityState.CHECKING,
                attempts=request.attempt,
            )
            run = await self._repository.update_capabilities(
                run.id,
                (checking,),
                state=_aggregate_after(run, checking.id, checking.state),
                updated_at=self._clock(),
            )

            outcome = await self._execute_check(adapter, request)
            terminal = _terminal_update(request, outcome)
            run = await self._repository.update_capabilities(
                run.id,
                (terminal,),
                state=_aggregate_after(run, terminal.id, terminal.state),
                updated_at=self._clock(),
            )

        return run

    async def _execute_check(
        self,
        adapter: CapabilityAdapter,
        request: CapabilityCheckRequest,
    ) -> CapabilityCheckOutcome:
        """Run a capability check and record observability metrics for it."""
        del adapter  # resolved again below; kept for symmetry with the registry
        provider = request.capability_id.value
        started_at = time.monotonic()
        try:
            outcome = await self._registry.adapter_for(request.capability_id).check(
                request
            )
        except asyncio.CancelledError:
            self._metrics.record(
                provider,
                OUTCOME_CANCELLED,
                (time.monotonic() - started_at) * 1000.0,
            )
            raise
        except BaseException as error:
            self._metrics.record(
                provider,
                OUTCOME_ERROR,
                (time.monotonic() - started_at) * 1000.0,
            )
            raise error
        if isinstance(outcome, CapabilityReady):
            kind = OUTCOME_SUCCESS
        elif isinstance(outcome, CapabilityTransientFailure):
            kind = OUTCOME_DEGRADED
        else:
            # CapabilityActionRequired means the provider answered but needs
            # user action; treat it as degraded service for observability.
            kind = OUTCOME_DEGRADED
        self._metrics.record(
            provider,
            kind,
            (time.monotonic() - started_at) * 1000.0,
        )
        return outcome


def _initial_capabilities(
    required_capability_ids: frozenset[CapabilityId],
) -> tuple[CapabilityReadiness, ...]:
    return tuple(
        CapabilityReadiness(
            id=capability_id,
            required=capability_id in required_capability_ids,
            state=CapabilityState.PENDING,
        )
        for capability_id in CapabilityId
    )


def _aggregate_after(
    run: PersistedReadinessRun,
    capability_id: CapabilityId,
    state: CapabilityState,
) -> AggregateState:
    return aggregate_state(
        state if capability.id is capability_id else capability.state
        for capability in run.capabilities
        if capability.required or capability.id is capability_id
    )


def _terminal_update(
    request: CapabilityCheckRequest,
    outcome: CapabilityCheckOutcome,
) -> CapabilityUpdate:
    if isinstance(outcome, CapabilityReady):
        return CapabilityUpdate(
            id=request.capability_id,
            state=CapabilityState.READY,
            attempts=request.attempt,
            safe_detail=outcome.safe_detail,
        )
    if isinstance(outcome, CapabilityTransientFailure):
        return CapabilityUpdate(
            id=request.capability_id,
            state=CapabilityState.DEGRADED,
            attempts=request.attempt,
            safe_detail=outcome.safe_detail,
            error=SafeError(
                code=outcome.code,
                message=outcome.message,
                retryable=True,
            ),
        )
    if isinstance(outcome, CapabilityActionRequired):
        return CapabilityUpdate(
            id=request.capability_id,
            state=CapabilityState.ACTION_REQUIRED,
            attempts=request.attempt,
            safe_detail=outcome.safe_detail,
            error=SafeError(
                code=outcome.code,
                message=outcome.message,
                retryable=False,
                recommended_action=outcome.recommended_action,
            ),
        )
    raise TypeError(f"Unsupported capability outcome: {type(outcome).__name__}")


def _utc_now() -> datetime:
    return datetime.now(UTC)
