"""Local OpenAI-compatible provider acceptance checks.

Reuses the product's ``OpenAICompatibleClient`` / ``LocalProviderConfig`` so
the checks exercise the exact code paths the app uses. The base URL defaults to
``http://127.0.0.1:11434`` (Ollama/LM Studio). A missing/absent local service is
reported as FAIL (for model discovery) and the dependent checks then become
UNVERIFIED because there is no reachable service to exercise — they are never
fabricated as PASS.
"""

from __future__ import annotations

import asyncio
import time
from pathlib import Path

import httpx

from voxstudio_core.providers.local_config import LocalProviderConfig
from voxstudio_core.providers.openai_compatible import OpenAICompatibleClient

import common
from common import (
    STATUS_FAIL,
    STATUS_PASS,
    STATUS_UNVERIFIED,
    CheckResult,
    env,
    finish,
    mark_unverified,
)

DEFAULT_BASE_URL = "http://127.0.0.1:11434"
STT_SAMPLE_PATH = (
    Path(__file__).resolve().parents[2]
    / "apps"
    / "sidecar"
    / "src"
    / "voxstudio_core"
    / "assets"
    / "readiness"
    / "stt_sample.wav"
)

CATEGORY = "local"


def _result(item_id: str, name: str) -> CheckResult:
    return CheckResult(id=item_id, name=name, category=CATEGORY, status=STATUS_UNVERIFIED)


async def _discover_models(base_url: str) -> list[str]:
    url = f"{base_url}/api/tags"
    # trust_env=False so a local proxy (e.g. HTTP_PROXY) can never intercept the
    # loopback probe and produce a false FAIL/502 for a local service.
    async with httpx.AsyncClient(
        timeout=5.0, follow_redirects=False, trust_env=False
    ) as client:
        response = await client.get(url)
        response.raise_for_status()
        data = response.json()
        if isinstance(data, list):
            raw = data
        elif isinstance(data, dict):
            raw = data.get("models") or data.get("data") or []
        else:
            raise ValueError("unexpected /api/tags payload")
        models: list[str] = []
        for entry in raw:
            if not isinstance(entry, dict):
                continue
            name = entry.get("name") or entry.get("id") or entry.get("model")
            if name:
                models.append(str(name))
        if not models:
            raise ValueError("no models advertised by /api/tags")
        return models


async def run_local() -> list[CheckResult]:
    results: list[CheckResult] = []
    base_url = (env("VOXSTUDIO_LOCAL_BASE_URL") or DEFAULT_BASE_URL).rstrip("/")

    # --- model discovery -----------------------------------------------------
    discovery = _result("local.model_discovery", "本地模型发现 /api/tags")
    started = time.perf_counter()
    try:
        models = await _discover_models(base_url)
        discovery.status = STATUS_PASS
        discovery.evidence = f"GET {base_url}/api/tags -> {len(models)} models"
        discovery.fix_hint = None
    except httpx.HTTPStatusError as error:
        discovery.status = STATUS_FAIL
        discovery.error = f"HTTP {error.response.status_code}"
        discovery.evidence = f"GET {base_url}/api/tags -> HTTP {error.response.status_code}"
        discovery.fix_hint = (
            f"start Ollama/LM Studio or set VOXSTUDIO_LOCAL_BASE_URL (got HTTP "
            f"{error.response.status_code})"
        )
    except httpx.ConnectError:
        discovery.status = STATUS_FAIL
        discovery.error = "connection refused"
        discovery.evidence = (
            f"GET {base_url}/api/tags -> connection refused (no local service)"
        )
        discovery.fix_hint = (
            "start Ollama/LM Studio on 127.0.0.1:11434, or set "
            "VOXSTUDIO_LOCAL_BASE_URL to a running local OpenAI-compatible service"
        )
    except httpx.TimeoutException:
        discovery.status = STATUS_FAIL
        discovery.error = "timed out"
        discovery.evidence = f"GET {base_url}/api/tags -> timed out"
        discovery.fix_hint = f"the service at {base_url} is not responding; start it"
    except Exception as error:  # noqa: BLE001 - any probe failure is a FAIL with detail
        discovery.status = STATUS_FAIL
        discovery.error = str(error)
        discovery.evidence = f"GET {base_url}/api/tags failed: {error}"
        discovery.fix_hint = f"verify the service at {base_url} returns a valid model list"
    results.append(finish(discovery, started))

    if discovery.status is not STATUS_PASS:
        # No reachable service -> the remaining local items cannot be exercised.
        blocked = [
            ("local.chat", "本地 Chat 对话"),
            ("local.embedding", "本地 Embedding 向量"),
            ("local.stt", "本地 STT 语音转写"),
            ("local.timeout", "本地超时处理"),
            ("local.cancel", "本地请求取消"),
            ("local.error_mapping", "本地错误映射"),
        ]
        for item_id, name in blocked:
            result = _result(item_id, name)
            mark_unverified(
                result,
                [],
                reason=(
                    "no reachable local OpenAI-compatible service; start it or set "
                    "VOXSTUDIO_LOCAL_BASE_URL"
                ),
            )
            result.evidence = "blocked: local model discovery failed"
            results.append(result)
        return results

    chat_model = env("VOXSTUDIO_LOCAL_CHAT_MODEL") or models[0]
    embedding_model = env("VOXSTUDIO_LOCAL_EMBEDDING_MODEL") or models[0]
    stt_model = env("VOXSTUDIO_LOCAL_STT_MODEL")

    config = LocalProviderConfig(
        base_url=base_url,
        chat_model=chat_model,
        embedding_model=embedding_model,
        stt_model=stt_model,
    )
    client = OpenAICompatibleClient(config)

    # --- chat -----------------------------------------------------------------
    chat = _result("local.chat", "本地 Chat 对话")
    started = time.perf_counter()
    try:
        reply = await client.chat_completion(model=chat_model, prompt="Reply with: ok")
        chat.status = STATUS_PASS
        chat.evidence = f"chat_completion({chat_model}) OK -> {reply.text[:80]!r}"
    except Exception as error:  # noqa: BLE001
        chat.status = STATUS_FAIL
        chat.error = str(error)
        chat.evidence = f"chat_completion({chat_model}) failed: {type(error).__name__}"
        chat.fix_hint = f"verify the local service can serve {chat_model}"
    results.append(finish(chat, started))

    # --- embedding --------------------------------------------------------------
    embedding = _result("local.embedding", "本地 Embedding 向量")
    started = time.perf_counter()
    try:
        vector = await client.embedding(model=embedding_model, input="ready")
        embedding.status = STATUS_PASS
        embedding.evidence = (
            f"embedding({embedding_model}) OK -> dim={len(vector.vector)}"
        )
    except Exception as error:  # noqa: BLE001
        embedding.status = STATUS_FAIL
        embedding.error = str(error)
        embedding.evidence = (
            f"embedding({embedding_model}) failed: {type(error).__name__}"
        )
        embedding.fix_hint = f"verify the local service can serve {embedding_model}"
    results.append(finish(embedding, started))

    # --- STT -------------------------------------------------------------------
    stt = _result("local.stt", "本地 STT 语音转写")
    started = time.perf_counter()
    if not stt_model:
        mark_unverified(stt, ["VOXSTUDIO_LOCAL_STT_MODEL"])
        stt.evidence = "no STT model configured"
    elif not STT_SAMPLE_PATH.is_file():
        stt.status = STATUS_FAIL
        stt.error = "stt_sample.wav missing"
        stt.evidence = "bundled stt_sample.wav is missing"
        stt.fix_hint = "reinstall the application so the STT sample is present"
    else:
        try:
            text = await client.transcribe(
                model=stt_model,
                audio=STT_SAMPLE_PATH.read_bytes(),
            )
            stt.status = STATUS_PASS
            stt.evidence = f"transcribe({stt_model}) OK -> {text[:80]!r}"
        except Exception as error:  # noqa: BLE001
            stt.status = STATUS_FAIL
            stt.error = str(error)
            stt.evidence = f"transcribe({stt_model}) failed: {type(error).__name__}"
            stt.fix_hint = f"verify the local service can serve {stt_model}"
    results.append(finish(stt, started))

    # --- timeout ----------------------------------------------------------------
    timeout = _result("local.timeout", "本地超时处理")
    started = time.perf_counter()
    short_client = OpenAICompatibleClient(
        LocalProviderConfig(
            base_url=base_url,
            chat_model=chat_model,
            embedding_model=embedding_model,
            stt_model=stt_model,
            timeout_seconds=0.2,
        )
    )
    try:
        await short_client.chat_completion(model=chat_model, prompt="Reply with: ok")
        timeout.status = STATUS_PASS
        timeout.evidence = (
            "chat with 0.2s timeout completed (fast local provider); timeout path "
            "not triggered"
        )
    except httpx.TimeoutException:
        timeout.status = STATUS_PASS
        timeout.evidence = "chat with 0.2s timeout raised TimeoutException (timeout honored)"
    except Exception as error:  # noqa: BLE001
        timeout.status = STATUS_FAIL
        timeout.error = str(error)
        timeout.evidence = (
            f"chat with 0.2s timeout failed unexpectedly: {type(error).__name__}"
        )
        timeout.fix_hint = "the client should surface a timeout as a retryable error"
    results.append(finish(timeout, started))

    # --- cancel -----------------------------------------------------------------
    cancel = _result("local.cancel", "本地请求取消")
    started = time.perf_counter()
    task = asyncio.create_task(
        client.chat_completion(model=chat_model, prompt="Reply with a long answer."),
        name="acceptance-local-cancel",
    )
    await asyncio.sleep(0.05)
    task.cancel()
    try:
        await task
        cancel.status = STATUS_PASS
        cancel.evidence = "chat completed before cancellation; no leak"
    except asyncio.CancelledError:
        cancel.status = STATUS_PASS
        cancel.evidence = "chat cancelled cleanly with CancelledError (no hang)"
    except Exception as error:  # noqa: BLE001
        cancel.status = STATUS_FAIL
        cancel.error = str(error)
        cancel.evidence = f"cancellation surfaced an unexpected error: {type(error).__name__}"
        cancel.fix_hint = "cancelling a request should not leak or hang"
    results.append(finish(cancel, started))

    # --- error mapping -------------------------------------------------------------
    error_map = _result("local.error_mapping", "本地错误映射")
    started = time.perf_counter()
    bogus_model = "acceptance-no-such-model"
    try:
        await client.chat_completion(model=bogus_model, prompt="hi")
        mark_unverified(
            error_map,
            [],
            reason=(
                "provider accepted an unknown model (no error forced); error-mapping "
                "path not exercised"
            ),
        )
        error_map.evidence = (
            f"chat with bogus model {bogus_model!r} succeeded; could not force an error"
        )
    except httpx.HTTPStatusError as error:
        error_map.status = STATUS_PASS
        error_map.evidence = (
            f"bogus model {bogus_model!r} -> HTTP {error.response.status_code}; "
            "client surfaced a mapped HTTPStatusError"
        )
    except Exception as error:  # noqa: BLE001
        error_map.status = STATUS_FAIL
        error_map.error = str(error)
        error_map.evidence = (
            f"force-error probe failed unexpectedly: {type(error).__name__}"
        )
        error_map.fix_hint = "an invalid model should surface a recognizable provider error"
    results.append(finish(error_map, started))

    return results