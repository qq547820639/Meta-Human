# Feishu Knowledge, Sync, and Citation Plan

**Goal:** Make Feishu Wiki a first-class knowledge source: one-time OAuth, Wiki node
discovery, Docx content synchronization, local indexing, retrieval, and cited answers
in the conversation experience.

**Scope guard:** No application account system. Tokens live in the macOS Keychain and
are never persisted in SQLite, logs, or the frontend.

## Task 1: OAuth State Machine

**Files:**

- Create: `apps/sidecar/src/voxstudio_core/knowledge/oauth.py`
- Create: `apps/sidecar/tests/unit/knowledge/test_oauth.py`

**Step 1:** Write failing tests for authorization URL creation, callback validation,
state nonce reuse, token refresh, revocation, and expiration handling.

**Step 2:** Confirm RED, implement, confirm GREEN.

## Task 2: Keychain Token Storage

**Files:**

- Create: `apps/desktop/src-tauri/src/keychain.rs`
- Create: `apps/desktop/src-tauri/tests/keychain_contract.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`

**Step 1:** Write failing tests for save, load, delete, overwrite, and redacted debug
output of OAuth tokens.

**Step 2:** Confirm RED, implement a narrow Keychain command, confirm GREEN.

## Task 3: Wiki and Docx Client

**Files:**

- Create: `apps/sidecar/src/voxstudio_core/knowledge/feishu.py`
- Create: `apps/sidecar/tests/unit/knowledge/test_feishu.py`

**Step 1:** Write failing tests for:

- Wiki space and node tree traversal with bounded pagination;
- Docx metadata and body download;
- rate-limit and quota errors mapped to safe retryable actions;
- empty or unauthorized spaces yield one recommended authorization action.

**Step 2:** Confirm RED, implement, confirm GREEN.

## Task 4: Local Sync and Index

**Files:**

- Create: `apps/sidecar/src/voxstudio_core/knowledge/indexer.py`
- Create: `apps/sidecar/src/voxstudio_core/persistence/migrations/002_knowledge.sql`
- Create: `apps/sidecar/tests/unit/knowledge/test_indexer.py`

**Step 1:** Write failing tests for incremental sync, document diffing, deletion
propagation, stable IDs, and transactional rollback.

**Step 2:** Confirm RED, implement the indexer and migration, confirm GREEN.

## Task 5: Retrieval and Citation

**Files:**

- Create: `apps/sidecar/src/voxstudio_core/knowledge/retrieval.py`
- Create: `apps/sidecar/tests/unit/knowledge/test_retrieval.py`

**Step 1:** Write failing tests for top-k retrieval, source attribution, citation
format, empty-index behavior, and answer grounding when no passage supports a claim.

**Step 2:** Confirm RED, implement, confirm GREEN.

## Task 6: Readiness and UI

**Files:**

- Modify: `apps/sidecar/src/voxstudio_core/capabilities/registry.py`
- Modify: `apps/desktop/src/features/readiness/ReadinessGate.tsx`
- Modify: `apps/desktop/src/features/readiness/ReadinessGate.test.tsx`

**Step 1:** Add tests that `knowledge` readiness requires OAuth, sync, index, and a
sample cited retrieval; the UI shows one authorize-and-sync action and a privacy
statement.

**Step 2:** Confirm RED, implement, confirm GREEN.

## Task 7: End-to-End Smoke

Run all suites, rebuild the sidecar, and verify:

- first run asks only for Feishu authorization;
- interrupted sync resumes without duplicate content;
- a test answer includes the Wiki source title and passage;
- revoking access fails closed without deleting local indexed content unexpectedly.

**Done when:** Feishu knowledge is authorized, synchronized, searchable, citable, and
recoverable.
