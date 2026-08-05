from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

from voxstudio_core.api.app import create_app
from voxstudio_core.config import SidecarConfig, generate_startup_token
from voxstudio_core.persistence.build_job_repository import (
    BuildJobRepository,
    CleanupState,
)
from voxstudio_core.persistence.database import Database
from voxstudio_core.persistence.digital_human_repository import (
    DigitalHumanRepository,
    DigitalHumanStatus,
)
from voxstudio_core.providers.build_job_service import BuildJobService
from voxstudio_core.providers.remote_gpu import AvatarStream


class StubRemoteClient:
    def __init__(self) -> None:
        self.stopped: list[str] = []
        self.voice_calls = 0
        self.avatar_calls = 0

    async def enroll_voice(self, *, audio: bytes) -> str:
        self.voice_calls += 1
        return "voice-1"

    async def enroll_avatar(self, *, image: bytes) -> str:
        self.avatar_calls += 1
        return "avatar-1"

    async def start_avatar_stream(
        self,
        *,
        avatar_id: str,
        voice_id: str,
    ) -> AvatarStream:
        return AvatarStream(
            session_id="stream-1",
            stream_url="https://gpu.example.com/live/stream-1",
        )

    async def stop_avatar_stream(self, *, session_id: str) -> None:
        self.stopped.append(session_id)


class FailingEnrollRemoteClient(StubRemoteClient):
    """Enrollment (rebuild/copy) fails so the original human must stay intact."""

    def __init__(self, *, fail_voice: bool = True) -> None:
        super().__init__()
        self.fail_voice = fail_voice

    async def enroll_voice(self, *, audio: bytes) -> str:
        if self.fail_voice:
            raise RuntimeError("voice enrollment failed")
        return await super().enroll_voice(audio=audio)


class FailingAvatarRemoteClient(StubRemoteClient):
    """Voice enrollment succeeds (so the human gains a remote voice id) but
    avatar enrollment fails, leaving the job FAILED and cleanable."""

    async def enroll_avatar(self, *, image: bytes) -> str:
        raise RuntimeError("avatar enrollment failed")


class EmptyLifecycle:
    async def startup(self) -> None:
        return None

    async def shutdown(self) -> None:
        return None

    async def current_run(self):
        return None

    async def start_or_resume(self):
        return None


@asynccontextmanager
async def running_client(
    token: str,
    database: Database,
    build_jobs: BuildJobService,
    humans: DigitalHumanRepository,
    remote: StubRemoteClient,
) -> AsyncIterator[AsyncClient]:
    app = create_app(
        config=SidecarConfig(bearer_token=token),
        lifecycle=EmptyLifecycle(),
        build_job_service=build_jobs,
        digital_humans=humans,
        avatar_stream_client=remote,
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
async def test_build_job_flow_creates_and_persists_human(
    tmp_path: Path,
) -> None:
    token = generate_startup_token()
    database = Database(tmp_path / "avatar.sqlite3")
    await database.connect()
    await database.migrate()
    humans = DigitalHumanRepository(database)
    remote = StubRemoteClient()
    build_jobs = BuildJobService(
        repository=BuildJobRepository(database),
        digital_humans=humans,
        client=remote,
    )
    portrait = tmp_path / "p.jpg"
    recording = tmp_path / "v.wav"
    portrait.write_bytes(b"img")
    recording.write_bytes(b"aud")
    try:
        async with running_client(
            token, database, build_jobs, humans, remote
        ) as client:
            human = await humans.create(name="Bob")
            job = await client.post(
                "/v1/avatar/jobs",
                headers=authorization(token),
                json={
                    "portrait_path": str(portrait),
                    "recording_path": str(recording),
                    "digital_human_id": human.id,
                },
            )
            assert job.status_code == 202
            job_id = job.json()["id"]

            for _ in range(100):
                status = await client.get(
                    f"/v1/avatar/jobs/{job_id}",
                    headers=authorization(token),
                )
                if status.json()["status"] in ("succeeded", "failed"):
                    break

            listing = await client.get(
                "/v1/avatar/humans",
                headers=authorization(token),
            )
            default = await client.get(
                "/v1/avatar/humans/default",
                headers=authorization(token),
            )
    finally:
        await database.close()

    assert status.json()["status"] == "succeeded"
    assert listing.status_code == 200
    assert [h["id"] for h in listing.json()["humans"]] == [human.id]
    assert default.json()["id"] == human.id


@pytest.mark.asyncio
async def test_avatar_stream_start_and_stop_are_wired(tmp_path: Path) -> None:
    token = generate_startup_token()
    database = Database(tmp_path / "avatar.sqlite3")
    await database.connect()
    await database.migrate()
    humans = DigitalHumanRepository(database)
    remote = StubRemoteClient()
    build_jobs = BuildJobService(
        repository=BuildJobRepository(database),
        digital_humans=humans,
        client=remote,
    )
    try:
        async with running_client(
            token, database, build_jobs, humans, remote
        ) as client:
            start = await client.post(
                "/v1/avatar/streams",
                headers=authorization(token),
                json={
                    "avatar_id": "avatar-1",
                    "voice_id": "voice-1",
                },
            )
            stop = await client.delete(
                "/v1/avatar/streams/stream-1",
                headers=authorization(token),
            )
    finally:
        await database.close()

    assert start.status_code == 200
    assert start.json() == {
        "session_id": "stream-1",
        "stream_url": "https://gpu.example.com/live/stream-1",
    }
    assert stop.status_code == 204


@pytest.mark.asyncio
async def test_current_job_returns_most_recent_unfinished_job(
    tmp_path: Path,
) -> None:
    token = generate_startup_token()
    database = Database(tmp_path / "avatar.sqlite3")
    await database.connect()
    await database.migrate()
    humans = DigitalHumanRepository(database)
    remote = StubRemoteClient()
    build_jobs = BuildJobService(
        repository=BuildJobRepository(database),
        digital_humans=humans,
        client=remote,
    )
    portrait = tmp_path / "p.jpg"
    recording = tmp_path / "v.wav"
    portrait.write_bytes(b"img")
    recording.write_bytes(b"aud")
    try:
        async with running_client(
            token, database, build_jobs, humans, remote
        ) as client:
            empty = await client.get(
                "/v1/avatar/jobs/current",
                headers=authorization(token),
            )
            job = await client.post(
                "/v1/avatar/jobs",
                headers=authorization(token),
                json={
                    "portrait_path": str(portrait),
                    "recording_path": str(recording),
                },
            )
            assert job.status_code == 202
            current = await client.get(
                "/v1/avatar/jobs/current",
                headers=authorization(token),
            )
    finally:
        await database.close()

    assert empty.status_code == 200
    assert empty.json() is None
    assert current.status_code == 200
    assert current.json()["id"] == job.json()["id"]


@pytest.mark.asyncio
async def test_avatar_routes_require_bearer_token(tmp_path: Path) -> None:
    token = generate_startup_token()
    database = Database(tmp_path / "avatar.sqlite3")
    await database.connect()
    await database.migrate()
    humans = DigitalHumanRepository(database)
    remote = StubRemoteClient()
    build_jobs = BuildJobService(
        repository=BuildJobRepository(database),
        digital_humans=humans,
        client=remote,
    )
    try:
        async with running_client(
            token, database, build_jobs, humans, remote
        ) as client:
            listing = await client.get("/v1/avatar/humans")
            default = await client.get("/v1/avatar/humans/default")
    finally:
        await database.close()

    assert listing.status_code == 401
    assert default.status_code == 401


async def _wait_for_terminal(client: AsyncClient, token: str, job_id: str) -> dict:
    for _ in range(200):
        response = await client.get(
            f"/v1/avatar/jobs/{job_id}",
            headers=authorization(token),
        )
        body = response.json()
        if body["status"] in ("succeeded", "failed", "cancelled"):
            return body
    raise AssertionError(f"job {job_id} did not reach a terminal state")


@pytest.mark.asyncio
async def test_rebuild_updates_same_record_and_keeps_default(tmp_path: Path) -> None:
    """A 'rebuild' job commits new remote ids to the SAME digital human record
    and preserves the default flag."""
    token = generate_startup_token()
    database = Database(tmp_path / "avatar.sqlite3")
    await database.connect()
    await database.migrate()
    humans = DigitalHumanRepository(database)
    remote = StubRemoteClient()
    build_jobs = BuildJobService(
        repository=BuildJobRepository(database),
        digital_humans=humans,
        client=remote,
    )
    portrait = tmp_path / "p.jpg"
    recording = tmp_path / "v.wav"
    portrait.write_bytes(b"img")
    recording.write_bytes(b"aud")
    try:
        async with running_client(
            token, database, build_jobs, humans, remote
        ) as client:
            original = await humans.create(name="Alice")
            await humans.set_default(original.id)
            await humans.update_status(
                original.id,
                status=DigitalHumanStatus.READY,
                voice_id="old-voice",
                avatar_id="old-avatar",
            )
            job = await client.post(
                "/v1/avatar/jobs",
                headers=authorization(token),
                json={
                    "portrait_path": str(portrait),
                    "recording_path": str(recording),
                    "digital_human_id": original.id,
                    "mode": "rebuild",
                },
            )
            assert job.status_code == 202
            job_id = job.json()["id"]
            terminal = await _wait_for_terminal(client, token, job_id)

            updated = await humans.get(original.id)
            humans_list = await humans.list()
    finally:
        await database.close()

    assert terminal["status"] == "succeeded"
    assert terminal["mode"] == "rebuild"
    # Same record, new remote ids, default preserved, original name kept.
    assert updated.id == original.id
    assert updated.name == "Alice"
    assert updated.voice_id == "voice-1"
    assert updated.avatar_id == "avatar-1"
    assert updated.is_default is True
    # Only one record exists — rebuild did not create a duplicate.
    assert [h.id for h in humans_list] == [original.id]


@pytest.mark.asyncio
async def test_rebuild_failure_retains_original_version(tmp_path: Path) -> None:
    """If a rebuild fails, the original available version must be preserved."""
    token = generate_startup_token()
    database = Database(tmp_path / "avatar.sqlite3")
    await database.connect()
    await database.migrate()
    humans = DigitalHumanRepository(database)
    remote = FailingEnrollRemoteClient()
    build_jobs = BuildJobService(
        repository=BuildJobRepository(database),
        digital_humans=humans,
        client=remote,
    )
    portrait = tmp_path / "p.jpg"
    recording = tmp_path / "v.wav"
    portrait.write_bytes(b"img")
    recording.write_bytes(b"aud")
    try:
        async with running_client(
            token, database, build_jobs, humans, remote
        ) as client:
            original = await humans.create(name="Bob")
            await humans.set_default(original.id)
            await humans.update_status(
                original.id,
                status=DigitalHumanStatus.READY,
                voice_id="original-voice",
                avatar_id="original-avatar",
            )
            job = await client.post(
                "/v1/avatar/jobs",
                headers=authorization(token),
                json={
                    "portrait_path": str(portrait),
                    "recording_path": str(recording),
                    "digital_human_id": original.id,
                    "mode": "rebuild",
                },
            )
            assert job.status_code == 202
            job_id = job.json()["id"]
            terminal = await _wait_for_terminal(client, token, job_id)

            preserved = await humans.get(original.id)
    finally:
        await database.close()

    assert terminal["status"] == "failed"
    # The original ready version is untouched.
    assert preserved.id == original.id
    assert preserved.creation_status == DigitalHumanStatus.READY
    assert preserved.voice_id == "original-voice"
    assert preserved.avatar_id == "original-avatar"
    assert preserved.is_default is True


@pytest.mark.asyncio
async def test_copy_creates_new_record_from_job_materials(tmp_path: Path) -> None:
    """A 'copy' job creates a NEW digital human record without touching the
    source record."""
    token = generate_startup_token()
    database = Database(tmp_path / "avatar.sqlite3")
    await database.connect()
    await database.migrate()
    humans = DigitalHumanRepository(database)
    remote = StubRemoteClient()
    build_jobs = BuildJobService(
        repository=BuildJobRepository(database),
        digital_humans=humans,
        client=remote,
    )
    portrait = tmp_path / "p.jpg"
    recording = tmp_path / "v.wav"
    portrait.write_bytes(b"img")
    recording.write_bytes(b"aud")
    try:
        async with running_client(
            token, database, build_jobs, humans, remote
        ) as client:
            source = await humans.create(name="Carol")
            await humans.set_default(source.id)
            await humans.update_status(
                source.id,
                status=DigitalHumanStatus.READY,
                voice_id="source-voice",
                avatar_id="source-avatar",
            )
            job = await client.post(
                "/v1/avatar/jobs",
                headers=authorization(token),
                json={
                    "portrait_path": str(portrait),
                    "recording_path": str(recording),
                    "digital_human_id": source.id,
                    "mode": "copy",
                },
            )
            assert job.status_code == 202
            job_id = job.json()["id"]
            terminal = await _wait_for_terminal(client, token, job_id)

            source_after = await humans.get(source.id)
            humans_list = await humans.list()
            copies = [h for h in humans_list if h.id != source.id]
    finally:
        await database.close()

    assert terminal["status"] == "succeeded"
    assert terminal["mode"] == "copy"
    # Source unchanged; a new copy record exists with the staged remote ids.
    assert source_after.voice_id == "source-voice"
    assert source_after.avatar_id == "source-avatar"
    assert source_after.is_default is True
    assert len(copies) == 1
    copy_record = copies[0]
    assert copy_record.name == "Carol（副本）"
    assert copy_record.voice_id == "voice-1"
    assert copy_record.avatar_id == "avatar-1"
    assert copy_record.is_default is False


@pytest.mark.asyncio
async def test_per_human_job_latest_and_history_are_scoped(tmp_path: Path) -> None:
    token = generate_startup_token()
    database = Database(tmp_path / "avatar.sqlite3")
    await database.connect()
    await database.migrate()
    humans = DigitalHumanRepository(database)
    remote = StubRemoteClient()
    build_jobs = BuildJobService(
        repository=BuildJobRepository(database),
        digital_humans=humans,
        client=remote,
    )
    portrait = tmp_path / "p.jpg"
    recording = tmp_path / "v.wav"
    portrait.write_bytes(b"img")
    recording.write_bytes(b"aud")
    try:
        async with running_client(
            token, database, build_jobs, humans, remote
        ) as client:
            bob = await humans.create(name="Bob")
            alice = await humans.create(name="Alice")
            job = await client.post(
                "/v1/avatar/jobs",
                headers=authorization(token),
                json={
                    "portrait_path": str(portrait),
                    "recording_path": str(recording),
                    "digital_human_id": bob.id,
                },
            )
            assert job.status_code == 202
            job_id = job.json()["id"]
            await _wait_for_terminal(client, token, job_id)

            bob_latest = await client.get(
                f"/v1/avatar/humans/{bob.id}/job",
                headers=authorization(token),
            )
            bob_history = await client.get(
                f"/v1/avatar/humans/{bob.id}/jobs",
                headers=authorization(token),
            )
            alice_latest = await client.get(
                f"/v1/avatar/humans/{alice.id}/job",
                headers=authorization(token),
            )
            missing = await client.get(
                "/v1/avatar/humans/nope/job",
                headers=authorization(token),
            )
    finally:
        await database.close()

    assert bob_latest.status_code == 200
    assert bob_latest.json()["id"] == job_id
    assert bob_latest.json()["digital_human_id"] == bob.id
    assert bob_latest.json()["cleanup_state"] == "none"

    assert bob_history.status_code == 200
    assert [j["id"] for j in bob_history.json()["jobs"]] == [job_id]
    assert bob_history.json()["has_more"] is False

    assert alice_latest.status_code == 200
    assert alice_latest.json() is None

    assert missing.status_code == 404


@pytest.mark.asyncio
async def test_delete_refuses_until_remote_cleanup_succeeded(tmp_path: Path) -> None:
    """Deleting a human with remote resources is refused until the tracked
    build job reports cleanup_state == succeeded; a failed/pending cleanup is a
    recoverable state, never reported as a completed delete."""
    token = generate_startup_token()
    database = Database(tmp_path / "avatar.sqlite3")
    await database.connect()
    await database.migrate()
    humans = DigitalHumanRepository(database)
    # Avatar enrollment fails -> the job is FAILED and cleanable, while the
    # human still owns a remote voice resource.
    remote = FailingAvatarRemoteClient()
    build_jobs = BuildJobService(
        repository=BuildJobRepository(database),
        digital_humans=humans,
        client=remote,
    )
    portrait = tmp_path / "p.jpg"
    recording = tmp_path / "v.wav"
    portrait.write_bytes(b"img")
    recording.write_bytes(b"aud")
    try:
        async with running_client(
            token, database, build_jobs, humans, remote
        ) as client:
            human = await humans.create(name="Bob")
            job = await client.post(
                "/v1/avatar/jobs",
                headers=authorization(token),
                json={
                    "portrait_path": str(portrait),
                    "recording_path": str(recording),
                    "digital_human_id": human.id,
                },
            )
            assert job.status_code == 202
            job_id = job.json()["id"]
            await _wait_for_terminal(client, token, job_id)

            # Remote resources exist and cleanup has not run -> refuse delete.
            refused = await client.delete(
                f"/v1/avatar/humans/{human.id}",
                headers=authorization(token),
            )
            assert refused.status_code == 409
            # Local record must still exist (recoverable, not faked as deleted).
            still_there = await client.get(
                f"/v1/avatar/humans/{human.id}",
                headers=authorization(token),
            )
            assert still_there.status_code == 200

            # Run cleanup; it succeeds against the stub provider.
            cleaned = await client.post(
                f"/v1/avatar/jobs/{job_id}/cleanup",
                headers=authorization(token),
            )
            assert cleaned.status_code == 200
            await _wait_for_terminal(client, token, job_id)
            job_state = await client.get(
                f"/v1/avatar/jobs/{job_id}",
                headers=authorization(token),
            )
            assert job_state.json()["cleanup_state"] == CleanupState.SUCCEEDED.value

            # Now delete is allowed.
            deleted = await client.delete(
                f"/v1/avatar/humans/{human.id}",
                headers=authorization(token),
            )
            assert deleted.status_code == 204
    finally:
        await database.close()
