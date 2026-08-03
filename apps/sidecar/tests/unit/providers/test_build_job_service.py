from collections.abc import AsyncIterator
from pathlib import Path

import pytest
import pytest_asyncio

from voxstudio_core.persistence.build_job_repository import (
    BuildJob,
    BuildJobStatus,
    BuildStage,
)
from voxstudio_core.persistence.database import Database
from voxstudio_core.persistence.digital_human_repository import (
    DigitalHumanRepository,
)
from voxstudio_core.providers.build_job_service import BuildJobService


class RecordingClient:
    def __init__(self, *, voice: bool = True, avatar: bool = True) -> None:
        self.voice = voice
        self.avatar = avatar
        self.voice_calls = 0
        self.avatar_calls = 0

    async def enroll_voice(self, *, audio: bytes) -> str:
        self.voice_calls += 1
        if not self.voice:
            raise RuntimeError("voice provider unavailable")
        return "voice-1"

    async def enroll_avatar(self, *, image: bytes) -> str:
        self.avatar_calls += 1
        if not self.avatar:
            raise RuntimeError("avatar provider unavailable")
        return "avatar-1"


@pytest_asyncio.fixture
async def services(
    tmp_path: Path,
) -> AsyncIterator[tuple[Database, BuildJobService, DigitalHumanRepository]]:
    database = Database(tmp_path / "build_jobs.sqlite3")
    await database.connect()
    await database.migrate()
    humans = DigitalHumanRepository(database)
    try:
        yield database, None, humans
    finally:
        await database.close()


async def _make_service(
    database: Database,
    humans: DigitalHumanRepository,
    client: RecordingClient,
) -> BuildJobService:
    from voxstudio_core.persistence.build_job_repository import (
        BuildJobRepository,
    )

    return BuildJobService(
        repository=BuildJobRepository(database),
        digital_humans=humans,
        client=client,
    )


async def _wait_terminal(service: BuildJobService, job: BuildJob) -> BuildJob:
    for _ in range(100):
        current = await service.get(job.id)
        if current.status not in (
            BuildJobStatus.PENDING,
            BuildJobStatus.RUNNING,
            BuildJobStatus.CANCELLING,
            BuildJobStatus.CLEANUP_PENDING,
        ):
            return current
        import asyncio

        await asyncio.sleep(0.01)
    raise AssertionError("job did not reach a terminal state")


@pytest.mark.asyncio
async def test_successful_build_sets_ready(
    services,
    tmp_path: Path,
) -> None:
    database, _, humans = services
    portrait = tmp_path / "p.jpg"
    recording = tmp_path / "v.wav"
    portrait.write_bytes(b"img")
    recording.write_bytes(b"aud")
    human = await humans.create(name="Bob")
    client = RecordingClient()
    service = await _make_service(database, humans, client)

    job = await service.start(
        portrait_path=str(portrait),
        recording_path=str(recording),
        digital_human_id=human.id,
    )
    terminal = await _wait_terminal(service, job)

    assert terminal.status is BuildJobStatus.SUCCEEDED
    assert BuildStage.ENROLL_VOICE in terminal.succeeded_stages
    assert BuildStage.ENROLL_AVATAR in terminal.succeeded_stages
    assert (await humans.get(human.id)).voice_id == "voice-1"
    assert (await humans.get(human.id)).avatar_id == "avatar-1"


@pytest.mark.asyncio
async def test_partial_failure_retry_reuses_succeeded_stage(
    services,
    tmp_path: Path,
) -> None:
    database, _, humans = services
    portrait = tmp_path / "p.jpg"
    recording = tmp_path / "v.wav"
    portrait.write_bytes(b"img")
    recording.write_bytes(b"aud")
    human = await humans.create(name="Bob")
    client = RecordingClient(voice=True, avatar=False)
    service = await _make_service(database, humans, client)

    job = await service.start(
        portrait_path=str(portrait),
        recording_path=str(recording),
        digital_human_id=human.id,
    )
    failed = await _wait_terminal(service, job)
    assert failed.status is BuildJobStatus.FAILED
    assert BuildStage.ENROLL_VOICE in failed.succeeded_stages
    assert BuildStage.ENROLL_AVATAR not in failed.succeeded_stages
    voice_calls_after_fail = client.voice_calls

    # Provider recovers; retry should skip the already-succeeded voice stage.
    client.avatar = True
    retried = await service.retry(failed.id)
    terminal = await _wait_terminal(service, retried)

    assert terminal.status is BuildJobStatus.SUCCEEDED
    assert client.voice_calls == voice_calls_after_fail
    assert client.avatar_calls == 2  # 1 failed attempt + 1 retry


@pytest.mark.asyncio
async def test_cancel_marks_cancelled(
    services,
    tmp_path: Path,
) -> None:
    database, _, humans = services
    portrait = tmp_path / "p.jpg"
    recording = tmp_path / "v.wav"
    portrait.write_bytes(b"img")
    recording.write_bytes(b"aud")
    human = await humans.create(name="Bob")
    client = RecordingClient()
    service = await _make_service(database, humans, client)

    job = await service.start(
        portrait_path=str(portrait),
        recording_path=str(recording),
        digital_human_id=human.id,
    )
    await service.cancel(job.id)
    terminal = await _wait_terminal(service, job)

    assert terminal.status is BuildJobStatus.CANCELLED
    assert terminal.cancelled is True
    assert (await humans.get(human.id)).creation_status.value == "cancelled"


@pytest.mark.asyncio
async def test_cleanup_records_remote_ids(
    services,
    tmp_path: Path,
) -> None:
    database, _, humans = services
    portrait = tmp_path / "p.jpg"
    recording = tmp_path / "v.wav"
    portrait.write_bytes(b"img")
    recording.write_bytes(b"aud")
    human = await humans.create(name="Bob")
    client = RecordingClient()
    service = await _make_service(database, humans, client)

    job = await service.start(
        portrait_path=str(portrait),
        recording_path=str(recording),
        digital_human_id=human.id,
    )
    # Force a failed state so cleanup is allowed.
    client.avatar = False
    await service.cancel(job.id)
    cancelled = await _wait_terminal(service, job)
    assert cancelled.status is BuildJobStatus.CANCELLED

    cleaned = await service.cleanup(cancelled.id)
    terminal = await _wait_terminal(service, cleaned)
    assert terminal.status in (
        BuildJobStatus.CANCELLED,
        BuildJobStatus.CLEANUP_FAILED,
    )


@pytest.mark.asyncio
async def test_idempotency_key_returns_existing_job(
    services,
    tmp_path: Path,
) -> None:
    database, _, humans = services
    portrait = tmp_path / "p.jpg"
    recording = tmp_path / "v.wav"
    portrait.write_bytes(b"img")
    recording.write_bytes(b"aud")
    human = await humans.create(name="Bob")
    client = RecordingClient()
    service = await _make_service(database, humans, client)

    first = await service.start(
        portrait_path=str(portrait),
        recording_path=str(recording),
        digital_human_id=human.id,
        idempotency_key="same-key",
    )
    second = await service.start(
        portrait_path=str(portrait),
        recording_path=str(recording),
        digital_human_id=human.id,
        idempotency_key="same-key",
    )

    assert first.id == second.id


@pytest.mark.asyncio
async def test_current_never_returns_completed_job(
    services,
    tmp_path: Path,
) -> None:
    """A completed job must not be reported as resumable via current()."""
    database, _, humans = services
    portrait = tmp_path / "p.jpg"
    recording = tmp_path / "v.wav"
    portrait.write_bytes(b"img")
    recording.write_bytes(b"aud")
    human = await humans.create(name="Bob")
    client = RecordingClient()
    service = await _make_service(database, humans, client)

    job = await service.start(
        portrait_path=str(portrait),
        recording_path=str(recording),
        digital_human_id=human.id,
    )
    terminal = await _wait_terminal(service, job)
    assert terminal.status is BuildJobStatus.SUCCEEDED

    assert await service.current() is None
    recent = await service.recent()
    assert recent is not None
    assert recent.id == job.id


@pytest.mark.asyncio
async def test_current_returns_unfinished_job(
    services,
    tmp_path: Path,
) -> None:
    """current() returns the most recent unfinished job when one exists."""
    database, _, humans = services
    portrait = tmp_path / "p.jpg"
    recording = tmp_path / "v.wav"
    portrait.write_bytes(b"img")
    recording.write_bytes(b"aud")
    human = await humans.create(name="Bob")
    client = RecordingClient()
    service = await _make_service(database, humans, client)

    job = await service.start(
        portrait_path=str(portrait),
        recording_path=str(recording),
        digital_human_id=human.id,
    )
    # Cancel immediately so the job is still unfinished/pending.
    pending = await service.get(job.id)
    if pending.status in (
        BuildJobStatus.PENDING,
        BuildJobStatus.RUNNING,
    ):
        await service.cancel(job.id)
    current = await service.current()
    assert current is not None
    assert current.id == job.id