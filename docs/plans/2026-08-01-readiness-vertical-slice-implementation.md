# Readiness Gate Vertical Slice Implementation Plan

> **For implementer:** Use TDD throughout. Write the failing test first, run it,
> confirm the expected failure, then write the minimum implementation.

**Goal:** Build a native macOS vertical slice that truthfully prepares, persists,
and displays the three required readiness outcomes before character creation can
begin.

**Architecture:** A Tauri 2 shell owns native lifecycle and the authoritative gate.
A React interface presents user-facing preparation states. A Python 3.12 FastAPI
sidecar runs capability checks, persists resumable progress in SQLite, and exposes
a loopback-only authenticated API. The first slice uses deterministic fake adapters;
real models, Feishu OAuth, and GPU engines are separate follow-up plans.

**Tech Stack:** Tauri 2, Rust stable, React, TypeScript, Vite, Vitest, Testing
Library, Python 3.12, uv, FastAPI, Pydantic v2, SQLite, pytest, httpx, pnpm.

**Working Name:** VoxStudio (`io.voxstudio.desktop`). Confirm the public product
name and final bundle identifier before signing or persisting production Keychain
records.

**Version-Control Note:** Commit steps are intentionally omitted because no Git
repository exists and the user has not requested commits.

---

## Scope Guard

This plan implements only the preparation gate and its local process boundary.
It does not install or integrate real LLM, STT, TTS, voice-clone, avatar, or
Feishu providers. It must never report those capabilities as ready without a
deterministic adapter result.

The three user-facing requirements are:

1. `conversation`
2. `voicePresence`
3. `knowledge`

Character creation remains locked unless all three required outcomes pass.

---

### Task 1: Install and Verify the Development Toolchain

**Files:** None

**Step 1: Verify the existing host**

Run:

```bash
uname -m
node --version
npm --version
pnpm --version
uv --version
git --version
clang --version
xcode-select -p
```

Expected: `arm64`; Node/npm/pnpm/uv/Git/Clang available; Command Line Tools at
`/Library/Developer/CommandLineTools`.

**Step 2: Install Rust stable**

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
  | sh -s -- -y --profile minimal --default-toolchain stable
source "$HOME/.cargo/env"
rustup component add rustfmt clippy
```

**Step 3: Verify Rust**

```bash
rustc --version
cargo --version
rustc --print host-tuple
rustup component list --installed
```

Expected host tuple: `aarch64-apple-darwin`; `rustfmt` and `clippy` installed.

**Step 4: Install Python 3.12 through uv**

```bash
uv python install 3.12
uv python find 3.12
```

Expected: a managed CPython 3.12 path. Do not modify `/usr/bin/python3`.

**Step 5: Record deferred release dependencies**

Full Xcode, Developer ID signing, notarization, FFmpeg distribution, and universal
builds are deferred. Command Line Tools are sufficient for this vertical slice.

---

### Task 2: Create the Monorepo Scaffold

**Files:**

- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `.gitignore`
- Create: `.editorconfig`
- Create: `apps/desktop/package.json`
- Create: `apps/desktop/index.html`
- Create: `apps/desktop/tsconfig.json`
- Create: `apps/desktop/vite.config.ts`
- Create: `apps/desktop/vitest.config.ts`
- Create: `apps/desktop/src/main.tsx`
- Create: `apps/desktop/src/test/setup.ts`
- Create: `apps/desktop/src/smoke.test.tsx`
- Create: `apps/desktop/src-tauri/Cargo.toml`
- Create: `apps/desktop/src-tauri/build.rs`
- Create: `apps/desktop/src-tauri/tauri.conf.json`
- Create: `apps/desktop/src-tauri/capabilities/default.json`
- Create: `apps/desktop/src-tauri/src/main.rs`
- Create: `apps/desktop/src-tauri/src/lib.rs`

Configuration files are scaffold exceptions to TDD. The first executable behavior
is still introduced through a failing smoke test.

**Step 1: Create the failing React smoke test**

Test behavior: rendering the application root displays `正在准备工作室`.

**Step 2: Install JavaScript dependencies and confirm RED**

```bash
pnpm install
pnpm --dir apps/desktop exec vitest run src/smoke.test.tsx
```

Expected: FAIL because the application root does not yet exist.

**Step 3: Add the minimum React root**

Create `apps/desktop/src/App.tsx` containing only the preparation heading needed by
the test.

**Step 4: Confirm GREEN and validate manifests**

```bash
pnpm --dir apps/desktop exec vitest run src/smoke.test.tsx
pnpm --dir apps/desktop exec tsc --noEmit
cargo metadata --manifest-path apps/desktop/src-tauri/Cargo.toml --no-deps
```

Expected: all commands pass.

---

### Task 3: Define the Authoritative Rust Readiness Contract

**Files:**

- Create: `apps/desktop/src-tauri/src/readiness.rs`
- Create: `apps/desktop/src-tauri/tests/readiness_contract.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`

**Step 1: Write failing contract tests**

Tests require:

- exactly `conversation`, `voicePresence`, and `knowledge`;
- all three are required;
- states serialize as `notStarted`, `checking`, `passed`, and `needsAction`;
- `canCreate` is false for zero requirements or any required non-passed state;
- `canCreate` is true only when every required state is passed;
- wire JSON uses camelCase.

**Step 2: Confirm RED**

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml \
  --test readiness_contract
```

Expected: FAIL because the readiness domain does not exist.

**Step 3: Implement the minimum Rust domain**

Add serializable enums and structs plus a pure `derive_can_create` function. Do not
add probes, persistence, progress percentages, or provider details.

**Step 4: Confirm GREEN**

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml \
  --test readiness_contract
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml \
  --all-targets -- -D warnings
```

Expected: PASS.

---

### Task 4: Expose a Truthful Tauri Baseline Snapshot

**Files:**

- Modify: `apps/desktop/src-tauri/src/readiness.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Modify: `apps/desktop/src-tauri/tests/readiness_contract.rs`

**Step 1: Write the failing command test**

The baseline snapshot must contain all three required outcomes in `notStarted` and
must return `canCreate: false`.

**Step 2: Confirm RED**

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml baseline_snapshot
```

Expected: FAIL because no snapshot builder exists.

**Step 3: Implement and register `get_readiness_snapshot`**

The Tauri command returns the truthful baseline. It must not read environment
variables or infer installed services yet.

**Step 4: Confirm GREEN**

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```

Expected: PASS.

---

### Task 5: Build the Readiness Gate Interface

**Files:**

- Create: `apps/desktop/src/features/readiness/types.ts`
- Create: `apps/desktop/src/features/readiness/readinessClient.ts`
- Create: `apps/desktop/src/features/readiness/readinessClient.test.ts`
- Create: `apps/desktop/src/features/readiness/ReadinessGate.tsx`
- Create: `apps/desktop/src/features/readiness/ReadinessGate.test.tsx`
- Create: `apps/desktop/src/features/readiness/ReadinessGate.css`
- Modify: `apps/desktop/src/App.tsx`
- Create: `apps/desktop/src/App.test.tsx`

**Step 1: Write failing client and component tests**

Tests require:

- `readinessClient` invokes exactly `get_readiness_snapshot`;
- human labels are `能够对话`, `能够听说和呈现`, and `能够使用知识`;
- the primary action reads `创建我的数字人`;
- the action is disabled unless `canCreate` is true;
- progress uses stage text, never a percentage or progressbar;
- technical details use a native `<details>` element closed by default;
- the loading state is honest and replaced by the Rust snapshot.

**Step 2: Confirm RED**

```bash
pnpm --dir apps/desktop exec vitest run \
  src/features/readiness/readinessClient.test.ts \
  src/features/readiness/ReadinessGate.test.tsx \
  src/App.test.tsx
```

Expected: FAIL because the feature does not exist.

**Step 3: Implement the minimum typed client and UI**

Map technical IDs and states to fixed human copy. Keep one primary action and at
most one recommended action per requirement. Do not add model/provider selectors.

**Step 4: Confirm GREEN**

```bash
pnpm --dir apps/desktop exec vitest run
pnpm --dir apps/desktop exec tsc --noEmit
pnpm --dir apps/desktop build
```

Expected: PASS.

---

### Task 6: Bootstrap the Python 3.12 Sidecar

**Files:**

- Create: `apps/sidecar/pyproject.toml`
- Create: `apps/sidecar/.python-version`
- Create: `apps/sidecar/src/voxstudio_core/__init__.py`
- Create: `apps/sidecar/tests/test_runtime.py`

**Step 1: Write the failing runtime test**

The test asserts Python 3.12 and imports `voxstudio_core`.

**Step 2: Confirm RED**

```bash
uv run --project apps/sidecar --python 3.12 \
  pytest apps/sidecar/tests/test_runtime.py -q
```

Expected: FAIL because the package does not exist.

**Step 3: Add the minimum package configuration**

Pin `requires-python = ">=3.12,<3.13"`. Add FastAPI, Pydantic v2, uvicorn, and
aiosqlite. Add pytest, pytest-asyncio, and httpx as development dependencies.

**Step 4: Sync and confirm GREEN**

```bash
uv sync --project apps/sidecar --python 3.12
uv run --project apps/sidecar pytest apps/sidecar/tests/test_runtime.py -q
```

Expected: PASS; commit `uv.lock` when version control is initialized.

---

### Task 7: Define Python Readiness Models and Gate Rules

**Files:**

- Create: `apps/sidecar/src/voxstudio_core/readiness/models.py`
- Create: `apps/sidecar/tests/unit/readiness/test_models.py`

**Step 1: Write failing model tests**

Define seven internal capabilities:

- `llm.chat`
- `embedding.text`
- `stt.transcribe`
- `tts.synthesize`
- `voice.enroll`
- `avatar.enroll`
- `avatar.stream`

Tests cover enum serialization, invalid values, aggregate precedence, grouping into
the three user-facing outcomes, and `gate_open` only when all required internal
capabilities are ready.

**Step 2: Confirm RED**

```bash
uv run --project apps/sidecar pytest \
  apps/sidecar/tests/unit/readiness/test_models.py -q
```

Expected: FAIL because the models do not exist.

**Step 3: Implement the minimum Pydantic models**

Capability states: `pending`, `checking`, `ready`, `degraded`, `action_required`,
and `failed`. Aggregate states additionally support `not_started`, `recovering`,
and `stopping`.

**Step 4: Confirm GREEN**

```bash
uv run --project apps/sidecar pytest \
  apps/sidecar/tests/unit/readiness/test_models.py -q
```

Expected: PASS.

---

### Task 8: Persist and Resume Readiness Work

**Files:**

- Create: `apps/sidecar/src/voxstudio_core/persistence/database.py`
- Create: `apps/sidecar/src/voxstudio_core/persistence/readiness_repository.py`
- Create: `apps/sidecar/src/voxstudio_core/persistence/migrations/001_readiness.sql`
- Create: `apps/sidecar/tests/unit/persistence/test_readiness_repository.py`
- Create: `apps/sidecar/tests/unit/persistence/test_readiness_resume.py`

**Step 1: Write failing repository tests**

Tests cover migration versioning, transactional create/update/load, rollback,
stable ordering, and no duplicate current run.

**Step 2: Write failing resume tests**

Interrupted `checking` entries become resumable `pending`/`recovering`; completed
checks remain ready; the latest incomplete run resumes.

**Step 3: Confirm RED**

```bash
uv run --project apps/sidecar pytest \
  apps/sidecar/tests/unit/persistence -q
```

Expected: FAIL because persistence is absent.

**Step 4: Implement the minimum SQLite repository**

Persist only safe status details, attempts, timestamps, and structured errors. Do
not persist startup tokens, API keys, raw document content, or media.

**Step 5: Confirm GREEN**

```bash
uv run --project apps/sidecar pytest \
  apps/sidecar/tests/unit/persistence -q
```

Expected: PASS.

---

### Task 9: Add Deterministic Capability Adapters and Orchestration

**Files:**

- Create: `apps/sidecar/src/voxstudio_core/capabilities/base.py`
- Create: `apps/sidecar/src/voxstudio_core/capabilities/registry.py`
- Create: `apps/sidecar/src/voxstudio_core/capabilities/fake.py`
- Create: `apps/sidecar/src/voxstudio_core/readiness/service.py`
- Create: `apps/sidecar/tests/unit/capabilities/test_fake_adapter.py`
- Create: `apps/sidecar/tests/unit/readiness/test_service.py`

**Step 1: Write failing adapter tests**

Fake adapters consume scripted typed outcomes, expose call history, never sleep or
use the network, and fail clearly when over-consumed.

**Step 2: Write failing orchestration tests**

The service persists `checking` before invocation and a terminal result afterward,
skips ready capabilities on resume, maps transient failures to recoverable state,
and maps user-remediable failures to `action_required` with one safe action.

**Step 3: Confirm RED**

```bash
uv run --project apps/sidecar pytest \
  apps/sidecar/tests/unit/capabilities \
  apps/sidecar/tests/unit/readiness/test_service.py -q
```

Expected: FAIL.

**Step 4: Implement the minimum adapter port and service**

Do not add real provider subclasses.

**Step 5: Confirm GREEN**

```bash
uv run --project apps/sidecar pytest apps/sidecar/tests/unit -q
```

Expected: PASS.

---

### Task 10: Secure the Loopback API and Error Boundary

**Files:**

- Create: `apps/sidecar/src/voxstudio_core/config.py`
- Create: `apps/sidecar/src/voxstudio_core/security.py`
- Create: `apps/sidecar/src/voxstudio_core/errors.py`
- Create: `apps/sidecar/tests/unit/test_security.py`
- Create: `apps/sidecar/tests/unit/test_errors.py`

**Step 1: Write failing security tests**

Reject non-loopback hosts, require a strong startup bearer token, compare tokens in
constant time, reject query-string tokens, and never persist or log the token.

**Step 2: Write failing error-contract tests**

The safe envelope contains `code`, `message`, `retryable`, optional
`recommended_action`, and `request_id`. Unexpected errors must not expose secrets
or tracebacks.

**Step 3: Confirm RED**

```bash
uv run --project apps/sidecar pytest \
  apps/sidecar/tests/unit/test_security.py \
  apps/sidecar/tests/unit/test_errors.py -q
```

Expected: FAIL.

**Step 4: Implement the minimum boundary**

Keep `/healthz` unauthenticated and minimal. Protect every readiness/control route.

**Step 5: Confirm GREEN**

```bash
uv run --project apps/sidecar pytest apps/sidecar/tests/unit -q
```

Expected: PASS.

---

### Task 11: Expose FastAPI Health and Readiness Endpoints

**Files:**

- Create: `apps/sidecar/src/voxstudio_core/api/app.py`
- Create: `apps/sidecar/src/voxstudio_core/api/routes/health.py`
- Create: `apps/sidecar/src/voxstudio_core/api/routes/readiness.py`
- Create: `apps/sidecar/src/voxstudio_core/lifecycle.py`
- Create: `apps/sidecar/src/voxstudio_core/main.py`
- Create: `apps/sidecar/tests/integration/api/test_health.py`
- Create: `apps/sidecar/tests/integration/api/test_readiness.py`
- Create: `apps/sidecar/tests/integration/api/test_error_contract.py`
- Create: `apps/sidecar/tests/integration/test_lifecycle.py`

**Step 1: Write failing API tests**

- `GET /healthz`: minimal liveness `200` while serving.
- `GET /readyz`: authenticated; `200` only when gate is open, otherwise `503` with
  the typed snapshot.
- `POST /v1/readiness/runs`: starts or resumes preparation.
- `GET /v1/readiness/runs/current`: returns the persisted snapshot.

**Step 2: Write the failing lifecycle test**

Startup migrates SQLite and restores the latest run. Shutdown stops admission,
persists in-flight checks as resumable, performs a bounded drain, and closes SQLite.

**Step 3: Confirm RED**

```bash
uv run --project apps/sidecar pytest \
  apps/sidecar/tests/integration -q
```

Expected: FAIL.

**Step 4: Implement the minimum FastAPI application**

Use FastAPI lifespan for startup/shutdown. Use polling for the first UI integration;
authenticated streaming is deferred until a real long-running provider requires it.

**Step 5: Confirm GREEN**

```bash
uv run --project apps/sidecar pytest apps/sidecar/tests -q
```

Expected: PASS.

---

### Task 12: Supervise the Sidecar from Tauri

**Files:**

- Create: `apps/desktop/src-tauri/src/sidecar.rs`
- Create: `apps/desktop/src-tauri/tests/sidecar_supervisor.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Modify: `apps/desktop/src-tauri/tauri.conf.json`
- Modify: `apps/desktop/src-tauri/capabilities/default.json`

**Step 1: Write failing supervisor tests**

Tests require a random strong token, loopback-only host, ephemeral port, bounded
health wait, one crash restart, graceful child termination on app exit, and no token
in logs or persisted configuration.

**Step 2: Confirm RED**

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml \
  --test sidecar_supervisor
```

Expected: FAIL because the supervisor does not exist.

**Step 3: Implement a process-runner abstraction and minimum supervisor**

Inject fake process and probe implementations in tests. Keep shell permissions
narrow and sidecar-specific. Do not grant arbitrary command execution.

**Step 4: Confirm GREEN**

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml \
  --all-targets -- -D warnings
```

Expected: PASS.

---

### Task 13: Connect the React Gate to Live Sidecar State

**Files:**

- Create: `apps/desktop/src/features/readiness/sidecarReadinessClient.ts`
- Create: `apps/desktop/src/features/readiness/sidecarReadinessClient.test.ts`
- Create: `apps/desktop/src/features/readiness/useReadiness.ts`
- Create: `apps/desktop/src/features/readiness/useReadiness.test.tsx`
- Modify: `apps/desktop/src/features/readiness/ReadinessGate.tsx`
- Modify: `apps/desktop/src/App.tsx`

**Step 1: Write failing client tests**

The client attaches the bearer token supplied through the native bridge, never uses
query tokens, maps safe API errors, and polls only while preparation is active.

**Step 2: Write failing hook/integration tests**

Tests cover start, checking, needs-action, resume, ready, app-background pause, and
cleanup. The creation button remains locked until the sidecar gate and Rust-derived
gate agree.

**Step 3: Confirm RED**

```bash
pnpm --dir apps/desktop exec vitest run \
  src/features/readiness/sidecarReadinessClient.test.ts \
  src/features/readiness/useReadiness.test.tsx \
  src/App.test.tsx
```

Expected: FAIL.

**Step 4: Implement the minimum integration**

The UI displays outcome-oriented stages and one recommended action. Technical
details remain collapsed. Never trust a client-computed gate without Rust
revalidation.

**Step 5: Confirm GREEN**

```bash
pnpm --dir apps/desktop exec vitest run
pnpm --dir apps/desktop exec tsc --noEmit
pnpm --dir apps/desktop build
```

Expected: PASS.

---

### Task 14: Package and Smoke-Test the Vertical Slice

**Files:**

- Create: `scripts/build-sidecar.sh`
- Create: `scripts/verify-foundation.sh`
- Modify: `apps/desktop/src-tauri/tauri.conf.json`
- Create: `docs/development.md`

**Step 1: Write verification expectations before scripts**

`verify-foundation.sh` must fail when Rust/Python dependencies or the sidecar binary
are absent and pass only after all focused suites and builds pass.

**Step 2: Build the arm64 sidecar**

Package through PyInstaller or Nuitka only after tests are green. Name the nested
binary with Tauri's target suffix:

```text
digital-human-sidecar-aarch64-apple-darwin
```

End users must not require Python or uv.

**Step 3: Run all automated gates**

```bash
uv run --project apps/sidecar pytest apps/sidecar/tests \
  --strict-markers --strict-config -q
pnpm --dir apps/desktop exec vitest run
pnpm --dir apps/desktop exec tsc --noEmit
pnpm --dir apps/desktop build
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml \
  --all-targets --all-features -- -D warnings
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```

Expected: all pass with no warnings promoted to errors.

**Step 4: Run the native smoke test**

```bash
pnpm --dir apps/desktop tauri dev
```

Verify:

- the app opens directly to `准备工作室`;
- all three outcomes start unprepared;
- starting preparation updates real persisted fake-adapter state;
- quitting mid-check and reopening resumes safely;
- all-passed unlocks character creation;
- a missing or crashed sidecar produces one recovery action and preserves state;
- paths containing spaces and Chinese characters work;
- quitting terminates the child process.

**Step 5: Record the next implementation plans**

Create separate TDD plans for:

1. local LLM/embedding/STT baseline;
2. personal voice/avatar remote GPU adapter;
3. Feishu OAuth, Wiki/Docx synchronization, and cited retrieval;
4. portrait/voice capture and the first-conversation experience;
5. signed/notarized DMG distribution.

---

## Final Verification

The vertical slice is complete only when:

- every test and build command above passes;
- no real capability is falsely reported as ready;
- preparation survives restart;
- the local API is loopback-only and bearer-protected;
- the user sees no model/provider/endpoint terminology by default;
- character creation cannot open until Rust revalidates the complete required gate.
