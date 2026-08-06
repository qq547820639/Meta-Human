#!/usr/bin/env python3
"""Launch the real sidecar binary plus a small mock provider for frontend E2E.

This reuses the proven launch recipe from ``scripts/smoke-mock-provider.py``
(loopback listener socket inherited as fd 9, ``VOXSTUDIO_*`` env vars, readiness
gate) but keeps the sidecar running and prints a single JSON line on stdout so a
Node/vitest helper can drive the real frontend API clients against the real HTTP
sidecar.

The mock provider is a real FastAPI HTTP server on an ephemeral port. It serves
the endpoints the sidecar depends on (chat completions incl. SSE streaming,
embeddings, transcriptions, voice/avatar enrollments, TTS, and the Feishu
endpoints). Nothing about the frontend is mocked here.

The sidecar's build-job flow requires a `digital_humans` row to exist before a
job can persist results (mirrors `tests/integration/api/test_avatar_build_api.py`,
which seeds the human via the repository directly). To keep the E2E deterministic
we seed that row up front using the same id both the launcher and the test agree
on. The seed is performed via the sidecar's own `Database`/`DigitalHumanRepository`
before the sidecar process starts, so the sidecar picks it up on startup.
"""

from __future__ import annotations

import asyncio
import json
import os
import signal
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path

import uvicorn
from fastapi import FastAPI, Request, Response
from fastapi.responses import StreamingResponse

PROJECT_ROOT = Path(__file__).resolve().parent.parent
SIDECAR_SRC = PROJECT_ROOT / "apps" / "sidecar" / "src"
BINARIES = PROJECT_ROOT / "apps" / "desktop" / "src-tauri" / "binaries"
# Always prefer the most recently built binary so a freshly rebuilt native
# sidecar wins over a stale universal one. An explicit VOXSTUDIO_SIDECAR env
# override still wins outright.
_candidates = [
    BINARIES / "digital-human-sidecar-aarch64-apple-darwin",
    BINARIES / "digital-human-sidecar-x86_64-apple-darwin",
    BINARIES / "digital-human-sidecar-universal-apple-darwin",
]
_existing = [candidate for candidate in _candidates if candidate.is_file()]
if _existing:
    SIDECAR = max(_existing, key=lambda candidate: candidate.stat().st_mtime)
else:
    SIDECAR = Path(
        os.environ.get(
            "VOXSTUDIO_SIDECAR",
            BINARIES / "digital-human-sidecar-universal-apple-darwin",
        )
    )

# Shared contract between the launcher and the E2E test.
E2E_HUMAN_ID = os.environ.get("VOXSTUDIO_E2E_HUMAN_ID", "human-e2e-1")
E2E_HUMAN_NAME = os.environ.get("VOXSTUDIO_E2E_HUMAN_NAME", "E2E Human")
# A second human with NO remote resources (never had a successful build job),
# which the honest-delete test deletes successfully without cleanup.
E2E_DELETE_HUMAN_ID = os.environ.get(
    "VOXSTUDIO_E2E_DELETE_HUMAN_ID", "human-e2e-delete"
)

# Small delay on the remote enrollment endpoints so a build job stays in
# RUNNING long enough for the frontend cancel test to hit it deterministically
# instead of racing an instant success.
ENROLL_DELAY_SECONDS = float(os.environ.get("VOXSTUDIO_E2E_ENROLL_DELAY", "1.5"))

# Delay between the mock chat-completion stream chunks. A longer delay keeps a
# stream active long enough for the frontend stop test to call
# `/v1/conversation/replies/stop` with a live generation_id instead of racing
# an instant completion.
STREAM_DELAY_SECONDS = float(os.environ.get("VOXSTUDIO_E2E_STREAM_DELAY", "0.2"))


def build_mock_app() -> FastAPI:
    app = FastAPI()

    @app.post("/v1/chat/completions")
    async def chat_completions(request: Request) -> Response:
        body = await request.json()
        if body.get("stream"):
            async def event_stream():
                for index in range(5):
                    if index > 0:
                        await asyncio.sleep(STREAM_DELAY_SECONDS)
                    chunk = {
                        "choices": [{"delta": {"content": "ready"}}]
                    }
                    yield f"data: {json.dumps(chunk)}\n\n"
                yield "data: [DONE]\n\n"

            return StreamingResponse(
                event_stream(),
                media_type="text/event-stream",
            )
        return Response(
            content=json.dumps(
                {"choices": [{"message": {"content": "ready"}}]}
            ),
            media_type="application/json",
        )

    @app.post("/v1/embeddings")
    async def embeddings() -> dict[str, object]:
        return {"data": [{"embedding": [0.1, 0.2, 0.3]}]}

    @app.post("/v1/audio/transcriptions")
    async def transcriptions() -> dict[str, str]:
        return {"text": "ready"}

    @app.post("/v1/voice/enrollments")
    async def voice_enrollments() -> dict[str, str]:
        await asyncio.sleep(ENROLL_DELAY_SECONDS)
        return {"id": "voice-mock"}

    @app.post("/v1/avatar/enrollments")
    async def avatar_enrollments() -> dict[str, str]:
        await asyncio.sleep(ENROLL_DELAY_SECONDS)
        return {"id": "avatar-mock"}

    @app.post("/v1/avatar/streams")
    async def avatar_streams() -> dict[str, str]:
        return {
            "session_id": "stream-mock",
            "stream_url": "http://127.0.0.1:1/live/stream-mock",
        }

    @app.delete("/v1/avatar/streams/stream-mock")
    async def avatar_stream_stop() -> Response:
        return Response(status_code=204)

    @app.post("/v1/audio/speech")
    async def audio_speech() -> Response:
        return Response(content=b"RIFF-mock", media_type="audio/wav")

    @app.get("/open-apis/wiki/v2/spaces/space-1/nodes")
    async def wiki_nodes() -> dict[str, object]:
        return {
            "data": {
                "items": [
                    {
                        "node_token": "node-1",
                        "obj_token": "doc-1",
                        "obj_type": "docx",
                        "title": "Mock Guide",
                        "has_child": False,
                    }
                ]
            }
        }

    @app.get("/open-apis/docx/v1/documents/doc-1/raw_content")
    async def raw_content() -> dict[str, object]:
        return {
            "data": {
                "document_name": "Mock Guide",
                "content": "Mock guide explains the ready mechanism.",
            }
        }

    @app.post("/open-apis/authen/v1/oidc/access_token")
    async def oauth_token() -> dict[str, object]:
        return {
            "data": {
                "access_token": "feishu-access",
                "refresh_token": "feishu-refresh",
                "expires_in": 7200,
            }
        }

    return app


def request(
    base_url: str,
    path: str,
    token: str,
    method: str = "GET",
    body: bytes | None = None,
) -> tuple[int, object]:
    import urllib.error
    import urllib.request

    headers = {"Authorization": f"Bearer {token}"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(
        f"{base_url}{path}",
        method=method,
        headers=headers,
        data=body,
    )
    try:
        with urllib.request.urlopen(req, timeout=3) as response:
            raw = response.read()
            return response.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as error:
        raw = error.read()
        return error.code, json.loads(raw) if raw else None
    except OSError:
        return None, None


async def seed_human(database_path: Path) -> None:
    """Create the digital human row the build-job flow needs, before the sidecar
    starts, so the first build job can persist its result and reach succeeded."""
    sys.path.insert(0, str(SIDECAR_SRC))
    from voxstudio_core.persistence.database import Database  # type: ignore
    from voxstudio_core.persistence.digital_human_repository import (  # type: ignore
        DigitalHumanRepository,
    )

    database = Database(database_path)
    await database.migrate()
    humans = DigitalHumanRepository(database)
    try:
        await humans.create(name=E2E_HUMAN_NAME, digital_human_id=E2E_HUMAN_ID)
        # Second, non-default human owned by the honest-delete test.
        await humans.create(
            name="E2E Delete Human", digital_human_id=E2E_DELETE_HUMAN_ID
        )
    finally:
        await database.close()


def main() -> int:
    app = build_mock_app()
    server = uvicorn.Server(
        uvicorn.Config(app=app, host="127.0.0.1", port=0, log_level="warning")
    )
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    while not getattr(server, "started", False):
        time.sleep(0.05)
    provider_port = server.servers[0].sockets[0].getsockname()[1]
    provider_url = f"http://127.0.0.1:{provider_port}"
    token = "T" * 43

    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(("127.0.0.1", 0))
    sock.listen(16)
    sidecar_url = f"http://127.0.0.1:{sock.getsockname()[1]}"
    os.dup2(sock.fileno(), 9)

    env = os.environ.copy()
    env.update(
        {
            "VOXSTUDIO_BEARER_TOKEN": token,
            "VOXSTUDIO_LOCAL_BASE_URL": provider_url,
            "VOXSTUDIO_LOCAL_CHAT_MODEL": "mock-chat",
            "VOXSTUDIO_LOCAL_EMBEDDING_MODEL": "mock-embed",
            "VOXSTUDIO_LOCAL_STT_MODEL": "mock-stt",
            "VOXSTUDIO_REMOTE_BASE_URL": provider_url,
            "VOXSTUDIO_FEISHU_ACCESS_TOKEN": "mock-token",
            "VOXSTUDIO_FEISHU_SPACE_ID": "space-1",
            "VOXSTUDIO_FEISHU_BASE_URL": provider_url,
            # Mock harness opts in to loopback for the remote/Feishu providers;
            # production never sets this flag.
            "VOXSTUDIO_ALLOW_LOOPBACK_PROVIDERS": "1",
        }
    )

    database = PROJECT_ROOT / "output" / "e2e-sidecar.sqlite3"
    if database.exists():
        database.unlink()
    database.parent.mkdir(parents=True, exist_ok=True)
    log_path = PROJECT_ROOT / "output" / "e2e-sidecar.log"

    asyncio.run(seed_human(database))

    with log_path.open("wb") as log_file:
        proc = subprocess.Popen(
            [str(SIDECAR), "--listener-fd", "9", "--database", str(database)],
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=log_file,
            stderr=subprocess.STDOUT,
            close_fds=False,
        )

    stop = threading.Event()

    def _on_term(_signum, _frame):
        stop.set()

    signal.signal(signal.SIGTERM, _on_term)
    signal.signal(signal.SIGINT, _on_term)

    try:
        health_ok = False
        for _ in range(60):
            if proc.poll() is not None:
                break
            status, _ = request(sidecar_url, "/healthz", token)
            if status == 200:
                health_ok = True
                break
            time.sleep(0.25)
        if not health_ok:
            print(log_path.read_text(errors="replace")[-4000:], file=sys.stderr)
            return 1

        request(sidecar_url, "/v1/readiness/runs", token, method="POST")

        gate_open = False
        for _ in range(120):
            status, body = request(sidecar_url, "/readyz", token)
            if isinstance(body, dict):
                gate_open = bool(body.get("gate_open"))
                if gate_open:
                    break
            time.sleep(0.25)
        if not gate_open:
            print(log_path.read_text(errors="replace")[-4000:], file=sys.stderr)
            return 1

        print(
            json.dumps(
                {
                    "sidecar_url": sidecar_url,
                    "token": token,
                    "database": str(database),
                }
            ),
            flush=True,
        )

        # Keep the sidecar (and mock provider) alive until the test tears down.
        while not stop.is_set():
            if proc.poll() is not None:
                break
            time.sleep(0.5)
    finally:
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()
        server.should_exit = True
        thread.join(timeout=2)
        sock.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())