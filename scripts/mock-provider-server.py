#!/usr/bin/env python3
"""Standalone mock OpenAI-compatible / remote-GPU / Feishu provider server.

This is the self-contained mock used by the CI ``provider-smoke`` job. It makes
the acceptance executor (``scripts/accept-providers/accept_providers.py``) able
to genuinely exercise the local, remote and Feishu categories against a
reachable loopback service — but ONLY in ``mock-harness`` mode
(``VOXSTUDIO_MOCK_PROVIDER=1``). Real credentials are never required and real
results are never fabricated: the report is stamped ``verification_kind=mock-harness``
so it is clearly distinguished from a real-credentials pass.

It serves exactly the endpoints the product's clients dial:

- Local (OpenAICompatibleClient + model discovery): ``/api/tags``,
  ``/v1/chat/completions``, ``/v1/embeddings``, ``/v1/audio/transcriptions``.
- Remote GPU (RemoteGpuClient): ``/health``, ``/v1/voice/enrollments``,
  ``/v1/avatar/enrollments``, ``/v1/avatar/streams``, ``/v1/avatar/streams/{id}``,
  ``/v1/audio/speech``.
- Feishu (FeishuClient): ``/open-apis/auth/v3/tenant_access_token/internal``,
  ``/open-apis/wiki/v2/spaces/{space_id}/nodes``,
  ``/open-apis/docx/v1/documents/{document_id}/raw_content``.

It binds to 127.0.0.1 on an ephemeral port and prints a single line
``MOCK_PROVIDER_PORT=<port>`` to stdout (flushed) so the caller (the shell
wrapper) can read the chosen port.
"""

from __future__ import annotations

import argparse
import sys
import threading
import time

import uvicorn
from fastapi import FastAPI, Response
from fastapi.responses import JSONResponse


def build_mock_app() -> FastAPI:
    app = FastAPI()

    # ---- local OpenAI-compatible -------------------------------------------
    @app.get("/api/tags")
    async def tags() -> dict[str, object]:
        return {"models": [{"name": "mock-chat", "model": "mock-chat"}]}

    @app.post("/v1/chat/completions")
    async def chat() -> dict[str, object]:
        return {"choices": [{"message": {"content": "ready"}}]}

    @app.post("/v1/embeddings")
    async def embeddings() -> dict[str, object]:
        return {"data": [{"embedding": [0.1, 0.2, 0.3]}]}

    @app.post("/v1/audio/transcriptions")
    async def transcriptions() -> dict[str, str]:
        return {"text": "ready"}

    # ---- remote GPU ----------------------------------------------------------
    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

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

    @app.delete("/v1/avatar/streams/{session_id}")
    async def avatar_stream_stop(session_id: str) -> Response:
        return Response(status_code=204)

    @app.post("/v1/audio/speech")
    async def audio_speech() -> Response:
        return Response(content=b"RIFF-mock-audio", media_type="audio/wav")

    # ---- Feishu --------------------------------------------------------------
    @app.post("/open-apis/auth/v3/tenant_access_token/internal")
    async def tenant_access_token() -> JSONResponse:
        return JSONResponse(
            {
                "code": 0,
                "msg": "ok",
                "tenant_access_token": "mock-tenant-token",
                "expire": 7200,
            }
        )

    @app.get("/open-apis/wiki/v2/spaces/{space_id}/nodes")
    async def wiki_nodes(space_id: str) -> dict[str, object]:
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

    @app.get("/open-apis/docx/v1/documents/{document_id}/raw_content")
    async def raw_content(document_id: str) -> dict[str, object]:
        return {
            "data": {
                "document_name": "Mock Guide",
                "content": "Mock guide explains the ready mechanism.",
            }
        }

    return app


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--port",
        type=int,
        default=0,
        help="port to bind (default 0 = ephemeral)",
    )
    args = parser.parse_args(argv if argv is not None else sys.argv[1:])

    app = build_mock_app()
    server = uvicorn.Server(
        uvicorn.Config(app=app, host="127.0.0.1", port=args.port, log_level="warning")
    )
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    while not getattr(server, "started", False):
        time.sleep(0.05)
    if not server.servers:
        return 1
    port = server.servers[0].sockets[0].getsockname()[1]
    # Machine-readable handshake for the calling shell wrapper.
    print(f"MOCK_PROVIDER_PORT={port}", flush=True)

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        server.should_exit = True
        thread.join(timeout=2)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())