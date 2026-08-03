import os
import time
from pathlib import Path

from fastapi.testclient import TestClient

from voxstudio_core.config import SidecarConfig
from voxstudio_core.main import build_app


def test_unconfigured_app_keeps_gate_closed_and_routes_absent(
    tmp_path: Path,
    monkeypatch,
) -> None:
    for key in list(os.environ):
        if key.startswith("VOXSTUDIO_"):
            monkeypatch.delenv(key, raising=False)

    config = SidecarConfig(
        host="127.0.0.1",
        port=0,
        bearer_token="a" * 64,
    )
    app = build_app(
        config=config,
        database_path=tmp_path / "state.sqlite3",
    )
    headers = {
        "Authorization": f"Bearer {config.bearer_token.get_secret_value()}"
    }

    with TestClient(app) as client:
        start = client.post("/v1/readiness/runs", headers=headers)
        assert start.status_code == 202

        snapshot = None
        for _ in range(50):
            response = client.get("/readyz", headers=headers)
            snapshot = response.json()
            if all(
                capability["state"] not in {"pending", "checking"}
                for capability in snapshot["capabilities"]
            ):
                break
            time.sleep(0.05)

        assert response.status_code == 503
        assert snapshot is not None
        assert snapshot["gate_open"] is False
        assert len(snapshot["capabilities"]) == 7
        assert all(
            capability["state"] == "action_required"
            for capability in snapshot["capabilities"]
        )
        assert all(
            capability["required"] is True
            for capability in snapshot["capabilities"]
        )

        conversation = client.post(
            "/v1/conversation/replies",
            headers=headers,
            json={"query": "你好"},
        )
        assert conversation.status_code == 404

        avatar = client.post(
            "/v1/avatar/builds",
            headers=headers,
            json={
                "portrait_path": "/tmp/portrait.jpg",
                "recording_path": "/tmp/voice.wav",
            },
        )
        assert avatar.status_code == 404
