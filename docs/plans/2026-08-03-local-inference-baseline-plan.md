# Local Inference Baseline Plan

**Goal:** Replace the deterministic fake adapters for `llm.chat`, `embedding.text`, and
`stt.transcribe` with real local or OpenAI-compatible baseline adapters while keeping
the readiness gate authoritative and user-facing copy infrastructure-free.

**Scope guard:** This plan does not add voice cloning, talking-avatar streaming, Feishu
authorization, or cloud credentials. It establishes the first real inference path and
the adapter contracts that later plans extend.

**Working decisions:**

- Local endpoints use the OpenAI-compatible wire contract (`/v1/chat/completions`,
  `/v1/embeddings`) so Ollama-style and compatible local servers work without a
  provider-specific client.
- STT uses a local OpenAI-compatible transcription endpoint when available, with a
  clear `needsAction` result and recommended action when no endpoint is configured.
- Provider settings stay in the sidecar configuration and are never shown as raw
  endpoint terminology in the default UI.

## Task 1: Define Local Provider Configuration

**Files:**

- Create: `apps/sidecar/src/voxstudio_core/providers/local_config.py`
- Create: `apps/sidecar/tests/unit/providers/test_local_config.py`

**Step 1:** Write failing tests for strict parsing of local base URLs, model names,
timeouts, and optional STT model selection. Invalid URLs, missing models, and
non-loopback remote URLs used without explicit opt-in must be rejected.

**Step 2:** Confirm RED.

```bash
uv run --project apps/sidecar pytest apps/sidecar/tests/unit/providers -q
```

**Step 3:** Implement the Pydantic model with `extra="forbid"` and deterministic
validation messages.

**Step 4:** Confirm GREEN and run clippy-equivalent checks for the sidecar:

```bash
uv run --project apps/sidecar pytest apps/sidecar/tests/unit/providers -q
```

## Task 2: Chat and Embedding Client

**Files:**

- Create: `apps/sidecar/src/voxstudio_core/providers/openai_compatible.py`
- Create: `apps/sidecar/tests/unit/providers/test_openai_compatible.py`

**Step 1:** Write failing tests for:

- chat completion sends exactly one bounded test prompt and returns a real reply;
- embedding returns a finite vector with the expected dimensionality;
- non-2xx responses map to safe retryable or actionable errors;
- timeouts are bounded and do not hang readiness;
- no API key, token, or endpoint is logged.

**Step 2:** Confirm RED.

**Step 3:** Implement the client with `httpx.AsyncClient`, a short readiness-specific
timeout, and safe error envelopes.

**Step 4:** Confirm GREEN.

## Task 3: STT Baseline Adapter

**Files:**

- Create: `apps/sidecar/src/voxstudio_core/capabilities/stt.py`
- Create: `apps/sidecar/tests/unit/capabilities/test_stt.py`

**Step 1:** Write failing tests for:

- a valid short WAV sample transcribes through the compatible endpoint;
- missing local endpoint returns `action_required` with one recommended action;
- malformed media returns a safe non-retryable error;
- empty transcription is treated as actionable, not ready.

**Step 2:** Confirm RED, then implement the adapter.

**Step 3:** Confirm GREEN.

## Task 4: Wire Real Adapters into Readiness

**Files:**

- Modify: `apps/sidecar/src/voxstudio_core/main.py`
- Modify: `apps/sidecar/src/voxstudio_core/readiness/service.py`
- Create: `apps/sidecar/tests/integration/providers/test_live_readiness.py`

**Step 1:** Write integration tests with a local stub OpenAI-compatible server that
proves `llm.chat`, `embedding.text`, and `stt.transcribe` reach real ready states and
the gate opens only when all required capabilities pass.

**Step 2:** Confirm RED, implement wiring, and confirm GREEN.

## Task 5: UI Copy and Recommended Actions

**Files:**

- Modify: `apps/desktop/src/features/readiness/useReadiness.ts`
- Modify: `apps/desktop/src/features/readiness/ReadinessGate.tsx`
- Modify: `apps/desktop/src/features/readiness/ReadinessGate.test.tsx`

**Step 1:** Add failing UI tests for one recommended action such as "启动本地模型服务"
without showing endpoints, ports, or model identifiers.

**Step 2:** Confirm RED, implement the copy mapping, and confirm GREEN.

## Task 6: End-to-End Smoke

Run:

```bash
uv run --project apps/sidecar pytest apps/sidecar/tests --strict-markers --strict-config -q
pnpm --dir apps/desktop exec vitest run
pnpm --dir apps/desktop exec tsc --noEmit
pnpm --dir apps/desktop build
scripts/build-sidecar.sh
scripts/verify-foundation.sh
```

Launch `pnpm --dir apps/desktop tauri dev` and verify the gate reaches ready with a
real local provider running, and reports one actionable recovery when it is not.

**Done when:** readiness reports real results, never claims a provider is ready
without a successful bounded sample call, and the default UI still shows only human
capability language.
