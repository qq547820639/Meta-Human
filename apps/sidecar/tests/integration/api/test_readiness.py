from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime

import pytest
from httpx import ASGITransport, AsyncClient

from voxstudio_core.api.app import create_app
from voxstudio_core.config import SidecarConfig, generate_startup_token
from voxstudio_core.persistence.readiness_repository import (
    PersistedCapability,
    PersistedReadinessRun,
    SafeError,
)
from voxstudio_core.readiness.models import (
    AggregateState,
    CapabilityId,
    CapabilityState,
)

NOW = datetime(2026, 8, 1, 9, 30, tzinfo=UTC)


def readiness_run(*, ready: bool) -> PersistedReadinessRun:
    capabilities = []
    for capability_id in CapabilityId:
        state = CapabilityState.READY
        error = None
        safe_detail = "Capability check passed."
        if not ready and capability_id is CapabilityId.LLM_CHAT:
            state = CapabilityState.DEGRADED
            safe_detail = "Conversation is recovering automatically."
            error = SafeError(
                code="model_starting",
                message="The conversation engine is still starting.",
                retryable=True,
            )
        capabilities.append(
            PersistedCapability(
                id=capability_id,
                required=True,
                state=state,
                attempts=1,
                safe_detail=safe_detail,
                error=error,
                created_at=NOW,
                updated_at=NOW,
            )
        )
    return PersistedReadinessRun(
        id="ready-run" if ready else "recovering-run",
        state=AggregateState.READY if ready else AggregateState.DEGRADED,
        capabilities=tuple(capabilities),
        created_at=NOW,
        updated_at=NOW,
        completed_at=None,
    )


class StubLifecycle:
    def __init__(self, current: PersistedReadinessRun | None) -> None:
        self.current = current
        self.start_calls = 0

    async def startup(self) -> None:
        return None

    async def shutdown(self) -> None:
        return None

    async def current_run(self) -> PersistedReadinessRun | None:
        return self.current

    async def start_or_resume(self) -> PersistedReadinessRun:
        self.start_calls += 1
        if self.current is None:
            self.current = readiness_run(ready=False)
        return self.current


@asynccontextmanager
async def running_client(
    lifecycle: StubLifecycle,
    token: str,
) -> AsyncIterator[AsyncClient]:
    app = create_app(
        config=SidecarConfig(bearer_token=token),
        lifecycle=lifecycle,
    )
    async with app.router.lifespan_context(app):
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://sidecar.test",
        ) as client:
            yield client


def authorization(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_readyz_returns_503_with_typed_snapshot_until_gate_opens() -> None:
    token = generate_startup_token()

    lifecycle = StubLifecycle(readiness_run(ready=False))
    async with running_client(lifecycle, token) as client:
        response = await client.get("/readyz", headers=authorization(token))

    assert response.status_code == 503
    assert response.json()["id"] == "recovering-run"
    assert response.json()["state"] == "degraded"
    assert response.json()["gate_open"] is False
    assert response.json()["outcomes"][0]["state"] == "degraded"
    assert response.json()["capabilities"][0]["error"] == {
        "code": "model_starting",
        "message": "The conversation engine is still starting.",
        "retryable": True,
        "recommended_action": None,
    }


@pytest.mark.asyncio
async def test_readyz_returns_not_started_snapshot_before_a_run_exists() -> None:
    token = generate_startup_token()

    async with running_client(StubLifecycle(None), token) as client:
        response = await client.get("/readyz", headers=authorization(token))

    body = response.json()
    assert response.status_code == 503
    assert body["id"] is None
    assert body["state"] == "not_started"
    assert body["gate_open"] is False
    assert [outcome["state"] for outcome in body["outcomes"]] == [
        "not_started",
        "not_started",
        "not_started",
    ]


@pytest.mark.asyncio
async def test_readyz_returns_200_only_when_gate_is_open() -> None:
    token = generate_startup_token()

    lifecycle = StubLifecycle(readiness_run(ready=True))
    async with running_client(lifecycle, token) as client:
        response = await client.get("/readyz", headers=authorization(token))

    assert response.status_code == 200
    assert response.json()["state"] == "ready"
    assert response.json()["gate_open"] is True


@pytest.mark.asyncio
async def test_post_starts_or_resumes_and_current_returns_persisted_snapshot() -> None:
    token = generate_startup_token()
    lifecycle = StubLifecycle(readiness_run(ready=False))

    async with running_client(lifecycle, token) as client:
        started = await client.post(
            "/v1/readiness/runs",
            headers=authorization(token),
        )
        current = await client.get(
            "/v1/readiness/runs/current",
            headers=authorization(token),
        )

    assert started.status_code == 202
    assert current.status_code == 200
    assert started.json() == current.json()
    assert current.json()["id"] == "recovering-run"
    assert lifecycle.start_calls == 1


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("method", "path"),
    (
        ("GET", "/readyz"),
        ("POST", "/v1/readiness/runs"),
        ("GET", "/v1/readiness/runs/current"),
    ),
)
async def test_every_readiness_route_requires_the_startup_bearer(
    method: str,
    path: str,
) -> None:
    token = generate_startup_token()

    lifecycle = StubLifecycle(readiness_run(ready=False))
    async with running_client(lifecycle, token) as client:
        response = await client.request(method, path)

    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"
    assert response.json()["code"] == "credential_error"


@pytest.mark.asyncio
async def test_readiness_router_rejects_forbidden_token_transports() -> None:
    token = generate_startup_token()
    lifecycle = StubLifecycle(readiness_run(ready=False))

    async with running_client(lifecycle, token) as client:
        query = await client.get(
            "/readyz",
            params={"access_token": token},
            headers=authorization(token),
        )
        cookie = await client.get(
            "/readyz",
            headers={
                "Authorization": f"Bearer {token}",
                "Cookie": f"token={token}",
            },
        )
        multiple = await client.get(
            "/readyz",
            headers=[
                ("Authorization", f"Bearer {token}"),
                ("Authorization", "Bearer wrong-token"),
            ],
        )

    assert {query.status_code, cookie.status_code, multiple.status_code} == {401}
    assert token not in query.text
    assert token not in cookie.text
    assert token not in multiple.text


@pytest.mark.asyncio
async def test_current_returns_safe_404_when_no_persisted_run_exists() -> None:
    token = generate_startup_token()

    async with running_client(StubLifecycle(None), token) as client:
        response = await client.get(
            "/v1/readiness/runs/current",
            headers=authorization(token),
        )

    assert response.status_code == 404
    assert response.json()["code"] == "readiness_run_not_found"
    assert response.json()["request_id"] == response.headers["x-request-id"]
