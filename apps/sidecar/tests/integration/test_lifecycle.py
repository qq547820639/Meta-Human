import asyncio
import logging
import os
import socket
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest

import voxstudio_core.main as sidecar_main
from voxstudio_core.capabilities.base import (
    CapabilityAdapter,
    CapabilityCheckOutcome,
    CapabilityCheckRequest,
    CapabilityReady,
)
from voxstudio_core.capabilities.fake import FakeCapabilityAdapter
from voxstudio_core.capabilities.registry import CapabilityAdapterRegistry
from voxstudio_core.config import generate_startup_token
from voxstudio_core.lifecycle import (
    LifecycleNotAcceptingError,
    SidecarLifecycle,
)
from voxstudio_core.persistence.database import Database
from voxstudio_core.persistence.readiness_repository import (
    CapabilityUpdate,
    PersistedReadinessRun,
    ReadinessRepository,
)
from voxstudio_core.readiness.models import (
    AggregateState,
    CapabilityId,
    CapabilityReadiness,
    CapabilityState,
)
from voxstudio_core.readiness.service import ReadinessService


NOW = datetime(2026, 8, 1, 10, 0, tzinfo=UTC)


def pending_capabilities() -> tuple[CapabilityReadiness, ...]:
    return tuple(
        CapabilityReadiness(
            id=capability_id,
            required=True,
            state=CapabilityState.PENDING,
        )
        for capability_id in CapabilityId
    )


class UnusedService:
    async def prepare(self) -> PersistedReadinessRun:
        raise AssertionError("startup must restore without starting preparation")


class StartupDatabase:
    def __init__(self) -> None:
        self.migrated = False
        self.close_calls = 0

    async def migrate(self) -> None:
        self.migrated = True

    async def close(self) -> None:
        self.close_calls += 1


class RestoreFailureRepository:
    def __init__(self, failure: BaseException) -> None:
        self._failure = failure

    async def resume_latest_incomplete_run(
        self,
        *,
        resumed_at: datetime,
    ) -> None:
        del resumed_at
        raise self._failure


class TrackingDatabase:
    def __init__(self, delegate: Database, events: list[str]) -> None:
        self._delegate = delegate
        self._events = events
        self.closed = False

    async def migrate(self) -> None:
        self._events.append("migrate")
        await self._delegate.migrate()

    async def close(self) -> None:
        self._events.append("close")
        await self._delegate.close()
        self.closed = True


class TrackingRepository:
    def __init__(self, delegate: ReadinessRepository, events: list[str]) -> None:
        self._delegate = delegate
        self._events = events

    async def create_or_get_current_run(
        self,
        *args: Any,
        **kwargs: Any,
    ) -> PersistedReadinessRun:
        return await self._delegate.create_or_get_current_run(*args, **kwargs)

    async def update_capabilities(
        self,
        *args: Any,
        **kwargs: Any,
    ) -> PersistedReadinessRun:
        return await self._delegate.update_capabilities(*args, **kwargs)

    async def load_current_run(self) -> PersistedReadinessRun | None:
        return await self._delegate.load_current_run()

    async def resume_latest_incomplete_run(
        self,
        *args: Any,
        **kwargs: Any,
    ) -> PersistedReadinessRun | None:
        self._events.append("resume")
        return await self._delegate.resume_latest_incomplete_run(*args, **kwargs)


class BlockingAdapter:
    def __init__(self, events: list[str]) -> None:
        self.started = asyncio.Event()
        self.cancelled = asyncio.Event()
        self._events = events

    async def check(
        self,
        request: CapabilityCheckRequest,
    ) -> CapabilityCheckOutcome:
        del request
        self.started.set()
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            self._events.append("adapter_cancelled")
            self.cancelled.set()
            raise


class FailingAdapter:
    def __init__(self, secret: str) -> None:
        self._secret = secret
        self.called = asyncio.Event()

    async def check(
        self,
        request: CapabilityCheckRequest,
    ) -> CapabilityCheckOutcome:
        del request
        self.called.set()
        raise RuntimeError(f"provider failure leaked {self._secret}")


def ready_adapters(
    override: tuple[CapabilityId, CapabilityAdapter],
) -> CapabilityAdapterRegistry:
    adapters: dict[CapabilityId, CapabilityAdapter] = {
        capability_id: FakeCapabilityAdapter(
            [CapabilityReady(safe_detail="Capability check passed.")]
        )
        for capability_id in CapabilityId
    }
    adapters[override[0]] = override[1]
    return CapabilityAdapterRegistry(adapters)


def test_main_accepts_startup_token_only_from_environment(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    token = generate_startup_token()
    database_path = tmp_path / "main.sqlite3"
    app = object()
    captured: dict[str, Any] = {}
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.bind(("127.0.0.1", 0))
    listener.listen()
    listener_address = listener.getsockname()
    inherited_fd = os.dup(listener.fileno())

    def fake_build_app(*, config: Any, database_path: Path) -> object:
        captured["config"] = config
        captured["database_path"] = database_path
        return app

    def fake_config(**options: Any) -> object:
        captured["uvicorn_config_options"] = options
        return object()

    class FakeServer:
        def __init__(self, config: object) -> None:
            captured["uvicorn_config"] = config

        def run(self, *, sockets: list[socket.socket]) -> None:
            captured["server_socket_addresses"] = [
                inherited.getsockname() for inherited in sockets
            ]

    monkeypatch.setenv("VOXSTUDIO_BEARER_TOKEN", token)
    monkeypatch.setattr(sidecar_main, "build_app", fake_build_app)
    monkeypatch.setattr(sidecar_main.uvicorn, "Config", fake_config)
    monkeypatch.setattr(sidecar_main.uvicorn, "Server", FakeServer)

    try:
        result = sidecar_main.main(
            [
                "--listener-fd",
                str(inherited_fd),
                "--database",
                str(database_path),
            ]
        )
    finally:
        listener.close()

    config = captured["config"]
    parser = sidecar_main._parser()
    option_strings = {
        option
        for action in parser._actions
        for option in action.option_strings
    }
    output = capsys.readouterr()
    assert result == 0
    assert config.bearer_token.get_secret_value() == token
    assert config.host == listener_address[0]
    assert config.port == listener_address[1]
    assert captured["database_path"] == database_path
    assert captured["uvicorn_config_options"] == {
        "app": app,
        "host": listener_address[0],
        "port": listener_address[1],
        "access_log": False,
    }
    assert captured["server_socket_addresses"] == [listener_address]
    assert "--listener-fd" in option_strings
    assert "--host" not in option_strings
    assert "--port" not in option_strings
    assert "--bearer-token" not in option_strings
    assert "--bearer-token" not in parser.format_help()
    assert token not in output.out
    assert token not in output.err


def test_inherited_listener_rejects_invalid_file_descriptor() -> None:
    with pytest.raises(ValueError, match="listener"):
        sidecar_main._listener_from_fd(-1)


def test_inherited_listener_rejects_udp_socket() -> None:
    udp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        udp.bind(("127.0.0.1", 0))
        inherited_fd = os.dup(udp.fileno())

        with pytest.raises(ValueError, match="TCP STREAM"):
            sidecar_main._listener_from_fd(inherited_fd)
    finally:
        udp.close()


def test_inherited_listener_rejects_non_loopback_socket() -> None:
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        listener.bind(("0.0.0.0", 0))
        listener.listen()
        inherited_fd = os.dup(listener.fileno())

        with pytest.raises(ValueError, match="loopback"):
            sidecar_main._listener_from_fd(inherited_fd)
    finally:
        listener.close()


def test_inherited_listener_rejects_socket_that_is_not_listening() -> None:
    bound_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        bound_socket.bind(("127.0.0.1", 0))
        inherited_fd = os.dup(bound_socket.fileno())

        with pytest.raises(ValueError, match="listening"):
            sidecar_main._listener_from_fd(inherited_fd)
    finally:
        bound_socket.close()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "failure",
    (
        pytest.param(RuntimeError("restore failed"), id="error"),
        pytest.param(asyncio.CancelledError(), id="cancelled"),
    ),
)
async def test_startup_failure_closes_database_and_keeps_admission_closed(
    failure: BaseException,
) -> None:
    database = StartupDatabase()
    lifecycle = SidecarLifecycle(
        database=database,
        repository=RestoreFailureRepository(failure),
        readiness_service=UnusedService(),
        clock=lambda: NOW,
    )

    with pytest.raises(type(failure)) as raised:
        await lifecycle.startup()

    assert raised.value is failure
    assert database.migrated is True
    assert database.close_calls == 1
    assert lifecycle.accepting_preparation is False
    with pytest.raises(LifecycleNotAcceptingError):
        await lifecycle.start_or_resume()


@pytest.mark.asyncio
async def test_background_failure_is_logged_safely_and_marked_resumable(
    tmp_path: Path,
    caplog: pytest.LogCaptureFixture,
) -> None:
    secret = "provider-secret-that-must-not-be-logged"
    database = Database(tmp_path / "background-failure.sqlite3")
    repository = ReadinessRepository(database)
    failing_adapter = FailingAdapter(secret)
    service = ReadinessService(
        repository=repository,
        registry=ready_adapters((CapabilityId.LLM_CHAT, failing_adapter)),
        clock=lambda: NOW,
    )
    lifecycle = SidecarLifecycle(
        database=database,
        repository=repository,
        readiness_service=service,
        clock=lambda: NOW,
    )
    caplog.set_level(logging.ERROR, logger="voxstudio_core.lifecycle")

    await lifecycle.startup()
    try:
        await lifecycle.start_or_resume()
        await asyncio.wait_for(failing_adapter.called.wait(), timeout=1)
        for _ in range(3):
            await asyncio.sleep(0)

        current = await lifecycle.current_run()

        assert current is not None
        assert current.state is AggregateState.RECOVERING
        assert current.capabilities[0].state is CapabilityState.PENDING
        assert "Readiness preparation failed" in caplog.text
        assert secret not in caplog.text
        assert "RuntimeError" not in caplog.text
        assert "Traceback" not in caplog.text
    finally:
        await lifecycle.shutdown()


@pytest.mark.asyncio
async def test_startup_migrates_sqlite_and_restores_latest_incomplete_run(
    tmp_path: Path,
) -> None:
    database_path = tmp_path / "restore.sqlite3"
    seed_database = Database(database_path)
    await seed_database.migrate()
    seed_repository = ReadinessRepository(seed_database)
    run = await seed_repository.create_or_get_current_run(
        pending_capabilities(),
        run_id="interrupted-run",
        created_at=NOW,
    )
    await seed_repository.update_capabilities(
        run.id,
        (
            CapabilityUpdate(
                id=CapabilityId.LLM_CHAT,
                state=CapabilityState.CHECKING,
                attempts=1,
            ),
        ),
        state=AggregateState.CHECKING,
        updated_at=NOW,
    )
    await seed_database.close()

    events: list[str] = []
    database = Database(database_path)
    tracking_database = TrackingDatabase(database, events)
    repository = TrackingRepository(ReadinessRepository(database), events)
    lifecycle = SidecarLifecycle(
        database=tracking_database,
        repository=repository,
        readiness_service=UnusedService(),
        clock=lambda: NOW,
    )

    await lifecycle.startup()
    restored = await lifecycle.current_run()

    assert await database.applied_migration_versions() == (
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15
    )
    assert restored is not None
    assert restored.id == "interrupted-run"
    assert restored.state is AggregateState.RECOVERING
    assert restored.capabilities[0].state is CapabilityState.PENDING
    assert lifecycle.accepting_preparation is True
    assert events[:2] == ["migrate", "resume"]

    await lifecycle.shutdown()
    assert tracking_database.closed is True


@pytest.mark.asyncio
async def test_shutdown_closes_admission_drains_bounded_work_and_persists_resume(
    tmp_path: Path,
) -> None:
    database_path = tmp_path / "shutdown.sqlite3"
    events: list[str] = []
    database = Database(database_path)
    tracking_database = TrackingDatabase(database, events)
    delegate_repository = ReadinessRepository(database)
    repository = TrackingRepository(delegate_repository, events)
    blocking_adapter = BlockingAdapter(events)
    service = ReadinessService(
        repository=repository,
        registry=ready_adapters((CapabilityId.LLM_CHAT, blocking_adapter)),
        clock=lambda: NOW,
    )
    lifecycle = SidecarLifecycle(
        database=tracking_database,
        repository=repository,
        readiness_service=service,
        clock=lambda: NOW,
        drain_timeout_seconds=0.01,
    )
    await lifecycle.startup()
    await lifecycle.start_or_resume()
    await asyncio.wait_for(blocking_adapter.started.wait(), timeout=1)

    shutdown = asyncio.create_task(lifecycle.shutdown())
    while lifecycle.accepting_preparation:
        await asyncio.sleep(0)

    with pytest.raises(LifecycleNotAcceptingError):
        await lifecycle.start_or_resume()
    await asyncio.wait_for(shutdown, timeout=1)

    assert blocking_adapter.cancelled.is_set()
    assert tracking_database.closed is True
    assert events[-3:] == ["adapter_cancelled", "resume", "close"]

    inspection_database = Database(database_path)
    inspection_repository = ReadinessRepository(inspection_database)
    resumed = await inspection_repository.load_current_run()
    try:
        assert resumed is not None
        assert resumed.state is AggregateState.RECOVERING
        assert resumed.capabilities[0].state is CapabilityState.PENDING
    finally:
        await inspection_database.close()
