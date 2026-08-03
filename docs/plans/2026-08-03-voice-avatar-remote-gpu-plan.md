# Voice and Avatar Remote GPU Plan

**Goal:** Implement real `voice.enroll`, `avatar.enroll`, `avatar.stream`, and
`tts.synthesize` adapters against an OpenAI-compatible remote GPU provider while
keeping explicit data-routing disclosure and bounded readiness checks.

**Scope guard:** This plan assumes the user has chosen a remote GPU or compatible
cloud provider. It does not bundle paid credentials, and it never treats a provider
as ready without a successful sample enrollment or stream test.

**Working decisions:**

- Provider capability extensions use `voice.enroll`, `avatar.enroll`, and
  `avatar.stream` as first-class readiness capabilities.
- Uploads use bounded sample media chosen by the app, not arbitrary user media, for
  readiness checks.
- A local fallback remains optional but never blocks a remote-provider completion.

## Task 1: Provider Capability Contract

**Files:**

- Create: `apps/sidecar/src/voxstudio_core/providers/remote_gpu.py`
- Create: `apps/sidecar/tests/unit/providers/test_remote_gpu.py`

**Step 1:** Write failing tests for strict provider configuration, required endpoint,
optional API key, media size limits, and timeout bounds.

**Step 2:** Confirm RED, then implement.

## Task 2: Voice Enrollment Adapter

**Files:**

- Create: `apps/sidecar/src/voxstudio_core/capabilities/voice.py`
- Create: `apps/sidecar/tests/unit/capabilities/test_voice.py`

**Step 1:** Write failing tests for:

- a bundled 5-10 second sample enrolls successfully;
- missing credentials map to `action_required` with one recommended action;
- oversized or corrupt samples are safe non-retryable errors;
- enrollment state is persisted and resumable.

**Step 2:** Confirm RED, implement, confirm GREEN.

## Task 3: Avatar Enrollment and Stream Adapter

**Files:**

- Create: `apps/sidecar/src/voxstudio_core/capabilities/avatar.py`
- Create: `apps/sidecar/tests/unit/capabilities/test_avatar.py`

**Step 1:** Write failing tests for enrollment upload, stream session start, stream
heartbeat, bounded startup failure, and clean session shutdown.

**Step 2:** Confirm RED, implement, confirm GREEN.

## Task 4: Readiness Integration

**Files:**

- Modify: `apps/sidecar/src/voxstudio_core/main.py`
- Modify: `apps/sidecar/src/voxstudio_core/readiness/service.py`
- Create: `apps/sidecar/tests/integration/providers/test_voice_avatar_readiness.py`

**Step 1:** Write integration tests with a stub provider that proves voice and avatar
capabilities reach ready, and that a missing provider yields one actionable recovery
while preserving completed work.

**Step 2:** Confirm RED, implement, confirm GREEN.

## Task 5: Data-Routing Disclosure

**Files:**

- Modify: `apps/desktop/src/features/readiness/ReadinessGate.tsx`
- Modify: `apps/desktop/src/features/readiness/ReadinessGate.test.tsx`

**Step 1:** Add UI tests for a single privacy boundary statement such as "声音和形象
只发送到你选择的 GPU 服务" and one recommended connection action.

**Step 2:** Confirm RED, implement, confirm GREEN.

## Task 6: Full Gate and Smoke

Run the full foundation gate and `tauri dev` smoke. Verify:

- readiness completes only with real remote adapter responses;
- stopping the remote provider fails closed with one recovery action;
- no credentials appear in logs, persisted state, or the default UI.

**Done when:** voice and avatar readiness are real, resumable, bounded, and safe.

## Implementation note

`ConversationService` now accepts an optional TTS client. When the remote GPU
provider is configured, conversation replies include base64 WAV audio and the
desktop UI renders it with a native audio control. TTS failures degrade to
text-only replies instead of pretending audio was generated.
