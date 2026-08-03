# Portrait, Voice Capture, and First Conversation Plan

**Goal:** Build the creation journey after readiness: portrait selection or capture,
voice sample recording, avatar build progress, and the first knowledge-grounded
conversation.

**Scope guard:** The readiness gate remains authoritative. Creation starts only after
Rust revalidates the full required gate.

## Task 1: Portrait Capture Command

**Files:**

- Create: `apps/desktop/src-tauri/src/media.rs`
- Create: `apps/desktop/src-tauri/tests/media_contract.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`

**Step 1:** Write failing tests for photo import validation, camera capture output,
privacy scope disclosure, and cancellation.

**Step 2:** Confirm RED, implement the narrow Tauri media commands, confirm GREEN.

## Task 2: Voice Sample Capture

**Files:**

- Create: `apps/desktop/src-tauri/src/recording.rs`
- Create: `apps/desktop/src-tauri/tests/recording_contract.rs`

**Step 1:** Write failing tests for microphone permission, bounded recording duration,
WAV validation, device failure, and user cancel.

**Step 2:** Confirm RED, implement, confirm GREEN.

## Task 3: Avatar Build Workflow

**Files:**

- Create: `apps/desktop/src/features/creation/avatarBuild.ts`
- Create: `apps/desktop/src/features/creation/avatarBuild.test.ts`
- Create: `apps/desktop/src/features/creation/CreationFlow.tsx`
- Create: `apps/desktop/src/features/creation/CreationFlow.test.tsx`

**Step 1:** Write failing tests for:

- create action calls the provider only after gate approval;
- progress uses honest stage text, never fake percentages;
- build failures preserve uploaded media and offer one recovery action;
- user can cancel or undo before the build starts.

**Step 2:** Confirm RED, implement, confirm GREEN.

## Task 4: First Conversation

**Files:**

- Create: `apps/desktop/src/features/conversation/Conversation.tsx`
- Create: `apps/desktop/src/features/conversation/Conversation.test.tsx`
- Create: `apps/sidecar/src/voxstudio_core/api/routes/conversation.py`
- Create: `apps/sidecar/tests/integration/conversation/test_conversation.py`

**Step 1:** Write failing tests for:

- first reply requires a ready gate and a built avatar;
- knowledge citations appear with source titles;
- voice and avatar rendering start only on explicit user action;
- errors fail closed without pretending a reply was generated.

**Step 2:** Confirm RED, implement, confirm GREEN.

## Task 5: Recovery and Persistence

**Files:**

- Modify: `apps/sidecar/src/voxstudio_core/persistence/database.py`
- Modify: `apps/desktop/src/features/creation/avatarBuild.ts`

**Step 1:** Write failing tests for resuming an interrupted build, retaining uploaded
media references, and cleaning partial state after explicit cancellation.

**Step 2:** Confirm RED, implement, confirm GREEN.

## Task 6: End-to-End Smoke

Run all suites, rebuild the sidecar, and verify in `tauri dev`:

- a fresh install reaches readiness, captures media, builds an avatar, and starts one
  conversation;
- every stage shows honest state and one recovery path;
- quitting mid-build resumes safely.

**Done when:** the app delivers one face, one voice, first reply, then memory without
fake progress or unsafe creation claims.
