"""Self-contained end-to-end readiness smoke against mock providers."""

from __future__ import annotations

import json
import os
import socket
import subprocess
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

import uvicorn
from fastapi import FastAPI, Response


PROJECT_ROOT = Path(__file__).resolve().parent.parent
STT_SAMPLE = (
    PROJECT_ROOT
    / "apps"
    / "sidecar"
    / "src"
    / "voxstudio_core"
    / "assets"
    / "readiness"
    / "stt_sample.wav"
)
BINARIES = PROJECT_ROOT / "apps/desktop/src-tauri/binaries"
SIDECAR = Path(
    os.environ.get(
        "VOXSTUDIO_SIDECAR",
        BINARIES / "digital-human-sidecar-universal-apple-darwin",
    )
)
if not SIDECAR.exists():
    SIDECAR = BINARIES / "digital-human-sidecar-aarch64-apple-darwin"


def build_mock_app() -> FastAPI:
    app = FastAPI()

    @app.post("/v1/chat/completions")
    async def chat() -> dict[str, object]:
        return {"choices": [{"message": {"content": "ready"}}]}

    @app.post("/v1/embeddings")
    async def embeddings() -> dict[str, object]:
        return {"data": [{"embedding": [0.1, 0.2, 0.3]}]}

    @app.post("/v1/audio/transcriptions")
    async def transcriptions() -> dict[str, str]:
        return {"text": "ready"}

    @app.post("/v1/voice/enrollments")
    async def voice_enrollments() -> dict[str, str]:
        return {"id": "voice-mock"}

    @app.post("/v1/avatar/enrollments")
    async def avatar_enrollments() -> dict[str, str]:
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
    headers = {"Authorization": f"Bearer {token}"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(
        f"{base_url}{path}",
        method=method,
        headers=headers,
        data=body,
    )
    try:
        with urllib.request.urlopen(request, timeout=3) as response:
            body = response.read()
            return response.status, json.loads(body) if body else None
    except urllib.error.HTTPError as error:
        body = error.read()
        return error.code, json.loads(body) if body else None
    except OSError:
        return None, None


def main() -> int:
    app = build_mock_app()
    server = uvicorn.Server(
        uvicorn.Config(app=app, host="127.0.0.1", port=0, log_level="warning")
    )
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    while not getattr(server, "started", False):
        time.sleep(0.05)
    port = server.servers[0].sockets[0].getsockname()[1]
    provider_url = f"http://127.0.0.1:{port}"
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
        }
    )
    database = PROJECT_ROOT / "output" / "mock-smoke.sqlite3"
    if database.exists():
        database.unlink()
    database.parent.mkdir(parents=True, exist_ok=True)
    log_path = PROJECT_ROOT / "output" / "mock-smoke.log"

    with log_path.open("wb") as log_file:
        proc = subprocess.Popen(
            [str(SIDECAR), "--listener-fd", "9", "--database", str(database)],
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=log_file,
            stderr=subprocess.STDOUT,
            close_fds=False,
        )

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
        print("healthz", health_ok, flush=True)
        if not health_ok:
            print(log_path.read_text(errors="replace")[-4000:])
            return 1

        start_status, _ = request(
            sidecar_url,
            "/v1/readiness/runs",
            token,
            method="POST",
        )
        print("start", start_status, flush=True)

        gate_open = False
        state = None
        for _ in range(120):
            status, body = request(sidecar_url, "/readyz", token)
            if isinstance(body, dict):
                gate_open = bool(body.get("gate_open"))
                state = body.get("state")
                if gate_open:
                    break
            time.sleep(0.25)
        print("readyz", gate_open, state, flush=True)
        if not gate_open:
            return 1

        conversation_status, conversation_body = request(
            sidecar_url,
            "/v1/conversation/replies",
            token,
            method="POST",
            body=json.dumps({"query": "Speak to me"}).encode(),
        )
        audio_ready = (
            isinstance(conversation_body, dict)
            and bool(conversation_body.get("audio_base64"))
        )
        print(
            "conversation",
            conversation_status,
            audio_ready,
            flush=True,
        )
        if conversation_status != 200 or not audio_ready:
            return 1

        history_status, history_body = request(
            sidecar_url,
            "/v1/conversation/history",
            token,
        )
        history_ready = (
            isinstance(history_body, dict)
            and len(history_body.get("messages", [])) >= 2
        )
        print("history", history_status, history_ready, flush=True)

        transcribe_status, transcribe_body = request(
            sidecar_url,
            "/v1/conversation/transcribe",
            token,
            method="POST",
            body=json.dumps(
                {"audio_path": str(STT_SAMPLE)}
            ).encode(),
        )
        transcribe_ready = (
            isinstance(transcribe_body, dict)
            and transcribe_body.get("text") == "ready"
        )
        print("transcribe", transcribe_status, transcribe_ready, flush=True)

        clear_status, clear_body = request(
            sidecar_url,
            "/v1/conversation/history",
            token,
            method="DELETE",
        )
        clear_ready = (
            isinstance(clear_body, dict)
            and clear_body.get("cleared") is True
        )
        print("clear", clear_status, clear_ready, flush=True)
        oauth_status, oauth_body = request(
            sidecar_url,
            "/v1/feishu/oauth/token",
            token,
            method="POST",
            body=json.dumps(
                {
                    "code": "code-1",
                    "app_id": "cli_app",
                    "app_secret": "secret",
                    "redirect_uri": (
                        "http://127.0.0.1:43125/oauth/feishu"
                    ),
                }
            ).encode(),
        )
        oauth_ready = (
            isinstance(oauth_body, dict)
            and oauth_body.get("access_token") == "feishu-access"
            and oauth_body.get("refresh_token") == "feishu-refresh"
        )
        print("oauth", oauth_status, oauth_ready, flush=True)
        stream_start_status, stream_start_body = request(
            sidecar_url,
            "/v1/avatar/streams",
            token,
            method="POST",
            body=json.dumps(
                {
                    "avatar_id": "avatar-mock",
                    "voice_id": "voice-mock",
                }
            ).encode(),
        )
        stream_start_ready = (
            isinstance(stream_start_body, dict)
            and stream_start_body.get("session_id") == "stream-mock"
            and bool(stream_start_body.get("stream_url"))
        )
        print(
            "stream_start",
            stream_start_status,
            stream_start_ready,
            flush=True,
        )
        stream_stop_status, _ = request(
            sidecar_url,
            "/v1/avatar/streams/stream-mock",
            token,
            method="DELETE",
        )
        stream_stop_ready = stream_stop_status == 204
        print("stream_stop", stream_stop_status, stream_stop_ready, flush=True)
        sources_status, sources_body = request(
            sidecar_url,
            "/v1/knowledge/sources",
            token,
        )
        sources_ready = (
            isinstance(sources_body, dict)
            and len(sources_body.get("sources", [])) >= 1
        )
        print("knowledge_sources", sources_status, sources_ready, flush=True)
        source_id = (
            sources_body["sources"][0]["document_id"]
            if sources_ready
            else None
        )
        source_delete_status = None
        if source_id:
            source_delete_status, _ = request(
                sidecar_url,
                f"/v1/knowledge/sources/{source_id}",
                token,
                method="DELETE",
            )
        source_delete_ready = source_delete_status == 204
        print(
            "knowledge_source_delete",
            source_delete_status,
            source_delete_ready,
            flush=True,
        )
        privacy_status, privacy_body = request(
            sidecar_url,
            "/v1/privacy/data",
            token,
            method="DELETE",
        )
        privacy_ready = (
            isinstance(privacy_body, dict)
            and privacy_body.get("cleared") is True
        )
        print("privacy_clear", privacy_status, privacy_ready, flush=True)
        memory_update_status, memory_update_body = request(
            sidecar_url,
            "/v1/conversation/memory",
            token,
            method="PUT",
            body=json.dumps({"summary": "mock memory"}).encode(),
        )
        memory_ready = (
            isinstance(memory_update_body, dict)
            and memory_update_body.get("summary") == "mock memory"
        )
        print("memory_update", memory_update_status, memory_ready, flush=True)
        memory_delete_status, _ = request(
            sidecar_url,
            "/v1/conversation/memory",
            token,
            method="DELETE",
        )
        memory_delete_ready = memory_delete_status == 200
        print(
            "memory_delete",
            memory_delete_status,
            memory_delete_ready,
            flush=True,
        )
        return (
            0
            if (
                history_ready
                and clear_ready
                and oauth_ready
                and transcribe_ready
                and stream_start_ready
                and stream_stop_ready
                and sources_ready
                and source_delete_ready
                and privacy_ready
                and memory_ready
                and memory_delete_ready
            )
            else 1
        )
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


if __name__ == "__main__":
    raise SystemExit(main())
