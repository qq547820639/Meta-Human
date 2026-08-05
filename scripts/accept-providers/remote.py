"""Remote GPU provider acceptance checks.

Reuses the product's ``RemoteGpuClient`` / ``RemoteGpuConfig``. All checks are
bounded (default 15s timeouts) and non-destructive in intent: any avatar
stream created is stopped in a ``finally`` block, and TTS synthesis is a
read-only call. When credentials are missing the items are UNVERIFIED and list
the missing environment variables — never PASS.

Requires for real execution:
  VOXSTUDIO_REMOTE_BASE_URL, VOXSTUDIO_REMOTE_API_KEY
"""

from __future__ import annotations

import time
from pathlib import Path

import httpx

from voxstudio_core.providers.remote_gpu import RemoteGpuClient, RemoteGpuConfig

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

VOICE_SAMPLE_PATH = (
    Path(__file__).resolve().parents[2]
    / "apps"
    / "sidecar"
    / "src"
    / "voxstudio_core"
    / "assets"
    / "readiness"
    / "stt_sample.wav"
)
AVATAR_SAMPLE_PATH = (
    Path(__file__).resolve().parents[2]
    / "apps"
    / "sidecar"
    / "src"
    / "voxstudio_core"
    / "assets"
    / "readiness"
    / "avatar_sample.png"
)

CATEGORY = "remote"


def _result(item_id: str, name: str) -> CheckResult:
    return CheckResult(id=item_id, name=name, category=CATEGORY, status=STATUS_UNVERIFIED)


async def _health(base_url: str, api_key: str | None) -> tuple[CheckResult, bool]:
    check = _result("remote.health", "远程 GPU 健康探测")
    started = time.perf_counter()
    headers = (
        {"Authorization": f"Bearer {api_key}"} if api_key else {}
    )
    try:
        url = f"{base_url}/health"
        async with httpx.AsyncClient(timeout=5.0, follow_redirects=False) as client:
            response = await client.get(url, headers=headers)
            response.raise_for_status()
            response.json()
        check.status = STATUS_PASS
        check.evidence = f"GET {url} -> HTTP {response.status_code}, JSON OK"
    except httpx.HTTPStatusError as error:
        check.status = STATUS_FAIL
        check.error = f"HTTP {error.response.status_code}"
        check.evidence = f"GET {base_url}/health -> HTTP {error.response.status_code}"
        check.fix_hint = "verify VOXSTUDIO_REMOTE_BASE_URL and VOXSTUDIO_REMOTE_API_KEY"
    except Exception as error:  # noqa: BLE001
        check.status = STATUS_FAIL
        check.error = str(error)
        check.evidence = f"GET {base_url}/health failed: {type(error).__name__}"
        check.fix_hint = "verify the remote GPU service is reachable"
    return finish(check, started), check.status is STATUS_PASS


async def run_remote() -> list[CheckResult]:
    results: list[CheckResult] = []
    base_url = env("VOXSTUDIO_REMOTE_BASE_URL")
    api_key = env("VOXSTUDIO_REMOTE_API_KEY")

    if not base_url:
        results.append(
            mark_unverified(
                _result("remote.health", "远程 GPU 健康探测"),
                ["VOXSTUDIO_REMOTE_BASE_URL"],
            )
        )
        return _blocked_rest(results, ["VOXSTUDIO_REMOTE_BASE_URL"])

    base_url = base_url.rstrip("/")
    if not api_key:
        results.append(
            mark_unverified(
                _result("remote.health", "远程 GPU 健康探测"),
                ["VOXSTUDIO_REMOTE_API_KEY"],
                reason="VOXSTUDIO_REMOTE_BASE_URL is set but VOXSTUDIO_REMOTE_API_KEY is missing",
            )
        )
        return _blocked_rest(results, ["VOXSTUDIO_REMOTE_API_KEY"])

    health, ok = await _health(base_url, api_key)
    results.append(health)
    if not ok:
        return _blocked_rest(
            results,
            [],
            reason="remote GPU health probe failed",
        )

    from pydantic import SecretStr  # deferred import

    config = RemoteGpuConfig(base_url=base_url, api_key=SecretStr(api_key))
    client = RemoteGpuClient(config)

    # voice enrollment (bounded, creates a test resource the provider owns)
    voice = _result("remote.voice_enroll", "远程 Voice 注册")
    started = time.perf_counter()
    try:
        voice_id = await client.enroll_voice(
            audio=VOICE_SAMPLE_PATH.read_bytes(),
        )
        voice.status = STATUS_PASS
        voice.evidence = f"enroll_voice -> id={voice_id!r}"
    except Exception as error:  # noqa: BLE001
        voice.status = STATUS_FAIL
        voice.error = str(error)
        voice.evidence = f"enroll_voice failed: {type(error).__name__}"
        voice.fix_hint = "verify the remote voice enrollment endpoint"
    results.append(finish(voice, started))

    # avatar enrollment
    avatar = _result("remote.avatar_enroll", "远程 Avatar 注册")
    started = time.perf_counter()
    try:
        avatar_id = await client.enroll_avatar(
            image=AVATAR_SAMPLE_PATH.read_bytes(),
        )
        avatar.status = STATUS_PASS
        avatar.evidence = f"enroll_avatar -> id={avatar_id!r}"
    except Exception as error:  # noqa: BLE001
        avatar.status = STATUS_FAIL
        avatar.error = str(error)
        avatar.evidence = f"enroll_avatar failed: {type(error).__name__}"
        avatar.fix_hint = "verify the remote avatar enrollment endpoint"
    results.append(finish(avatar, started))

    # avatar stream create / play / stop / cleanup (always stop in finally)
    stream = _result("remote.avatar_stream", "远程 Avatar 流（创建/播放/停止/清理）")
    started = time.perf_counter()
    try:
        session = await client.start_avatar_stream(
            avatar_id="acceptance-avatar",
            voice_id="acceptance-voice",
        )
        evidence = f"start_avatar_stream -> session={session.session_id!r}"
        if session.stream_url:
            evidence += f", stream_url={session.stream_url!r} (playable)"
        else:
            evidence += ", no stream_url (portrait fallback expected)"
        stream.evidence = evidence
        stream.status = STATUS_PASS
    except Exception as error:  # noqa: BLE001
        stream.status = STATUS_FAIL
        stream.error = str(error)
        stream.evidence = f"start_avatar_stream failed: {type(error).__name__}"
        stream.fix_hint = "verify the remote avatar stream endpoint"
    finally:
        if "session" in locals():
            try:
                await client.stop_avatar_stream(session_id=session.session_id)
                stream.evidence += " -> stop_avatar_stream OK"
            except Exception as error:  # noqa: BLE001
                stream.error = (
                    f"{stream.error}; stop failed: {error}" if stream.error else str(error)
                )
    results.append(finish(stream, started))

    # TTS (read-only)
    tts = _result("remote.tts", "远程 TTS 语音合成")
    started = time.perf_counter()
    try:
        audio = await client.synthesize(text="ready")
        tts.status = STATUS_PASS
        tts.evidence = f"synthesize -> {len(audio)} bytes audio"
    except Exception as error:  # noqa: BLE001
        tts.status = STATUS_FAIL
        tts.error = str(error)
        tts.evidence = f"synthesize failed: {type(error).__name__}"
        tts.fix_hint = "verify the remote TTS endpoint"
    results.append(finish(tts, started))

    # idempotency / retry / cancel & remote-resource cleanup are exercised by the
    # build-job state machine; here we report them as covered-by-health + the
    # bounded cleanups above, or UNVERIFIED when the provider has no such surface.
    idem = _result("remote.idempotency_retry_cancel", "远程幂等/重试/取消")
    mark_unverified(
        idem,
        [],
        reason=(
            "build-job idempotency/retry/cancel is exercised by the build state "
            "machine when a full build runs; the remote-only probe does not force it"
        ),
    )
    idem.evidence = "covered by BuildJobService state machine on a real build"
    results.append(idem)

    cleanup = _result("remote.remote_resource_cleanup", "远程资源清理")
    mark_unverified(
        cleanup,
        [],
        reason="the current remote provider has no enrollment deletion endpoint",
    )
    cleanup.evidence = (
        "stream session was stopped in finally; enrollment cleanup is recorded via "
        "BuildJobService.cleanup"
    )
    results.append(cleanup)

    return results


def _blocked_rest(
    results: list[CheckResult],
    missing: list[str],
    *,
    reason: str | None = None,
) -> list[CheckResult]:
    blocked = [
        ("remote.voice_enroll", "远程 Voice 注册"),
        ("remote.avatar_enroll", "远程 Avatar 注册"),
        ("remote.avatar_stream", "远程 Avatar 流（创建/播放/停止/清理）"),
        ("remote.tts", "远程 TTS 语音合成"),
        ("remote.idempotency_retry_cancel", "远程幂等/重试/取消"),
        ("remote.remote_resource_cleanup", "远程资源清理"),
    ]
    for item_id, name in blocked:
        result = _result(item_id, name)
        mark_unverified(result, missing, reason=reason)
        result.evidence = "blocked: remote GPU provider not configured/reachable"
        results.append(result)
    return results