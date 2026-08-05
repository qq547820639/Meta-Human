/**
 * Real-Sidecar end-to-end test for the FRONTEND API clients.
 *
 * This deliberately does NOT mock `fetch`. It launches the real sidecar binary
 * plus a mock provider, mocks ONLY the Tauri `invoke` binding so the clients
 * resolve the real sidecar `baseUrl`/`bearerToken`, and then drives the real
 * frontend API clients against the real HTTP sidecar.
 *
 * It covers the restore client, avatar build client, conversation management
 * client, and conversation client — closing the "真实 Sidecar E2E" gap in
 * Task 12 of the integration-convergence spec.
 */
import { invoke } from "@tauri-apps/api/core";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { BuildJobData } from "../api/contracts";
import {
  createBuildJob,
  cancelBuildJob,
  cleanupBuildJob,
  deleteHuman,
  getDefaultDigitalHuman,
  getBuildJob,
  listHumans,
  renameHuman,
  retryBuildJob,
  setDefaultHuman,
} from "../features/creation/avatarBuildClient";
import {
  postConversationReply,
  stopGenerating,
  streamConversationReply,
} from "../features/conversation/conversationClient";
import {
  archiveConversation,
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  renameConversation,
  unarchiveConversation,
} from "../features/conversation/conversationManagementClient";
import {
  fetchDefaultHuman,
  fetchResumableBuildJob,
} from "../features/restore/restoreClient";
import {
  launchSidecar,
  sidecarAvailable,
  type SidecarConnection,
} from "./launchSidecar";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

// The launcher seeds this digital human row up front (see
// `scripts/e2e-sidecar-launcher.py` -> `E2E_HUMAN_ID`). Build jobs must target
// it so results persist.
const E2E_HUMAN_ID = "human-e2e-1";

// A second human seeded by the launcher with NO remote resources (it never had
// a successful build job), used to positively exercise the delete path. Unlike
// `E2E_HUMAN_ID` — which owns remote resources from succeeded build jobs and so
// is honest-delete gated — this one can be deleted without cleanup.
const E2E_DELETE_HUMAN_ID = "human-e2e-delete";

const suite = sidecarAvailable() ? describe.sequential : describe.skip;
suite("sidecar E2E (real binary, fetch not mocked)", () => {
  let connection: SidecarConnection;
  let stop: () => Promise<void>;
  const tempDirs: string[] = [];

  beforeAll(async () => {
    const handle = await launchSidecar();
    connection = handle.connection;
    stop = handle.stop;
    vi.mocked(invoke).mockResolvedValue({
      baseUrl: connection.baseUrl,
      bearerToken: connection.bearerToken,
    });
  }, 120_000);

  afterAll(async () => {
    await stop?.();
    for (const dir of tempDirs) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup.
      }
    }
  });

  function sleep(ms: number): Promise<void> {
    return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
  }

  /** Creates a fresh media pair with unique paths -> unique idempotency key. */
  function makeMedia(): { portraitPath: string; recordingPath: string } {
    const dir = mkdtempSync(join(tmpdir(), "e2e-media-"));
    tempDirs.push(dir);
    const portraitPath = join(dir, "portrait.jpg");
    const recordingPath = join(dir, "recording.wav");
    writeFileSync(portraitPath, Buffer.from(`portrait-${dir}`));
    writeFileSync(recordingPath, Buffer.from(`recording-${dir}`));
    return { portraitPath, recordingPath };
  }

  async function pollJobStatus(
    jobId: string,
    expected: string,
    timeoutMs = 40_000,
  ): Promise<BuildJobData> {
    const deadline = Date.now() + timeoutMs;
    let last: BuildJobData | undefined;
    while (Date.now() < deadline) {
      last = await getBuildJob(jobId);
      if (last.status === expected) {
        return last;
      }
      await sleep(200);
    }
    throw new Error(
      `job ${jobId} did not reach "${expected}" (last=${last?.status})`,
    );
  }

  it("creates a build job and polls it to succeeded (human becomes ready)", async () => {
    const { portraitPath, recordingPath } = makeMedia();
    const job = await createBuildJob({
      portraitPath,
      recordingPath,
      digitalHumanId: E2E_HUMAN_ID,
    });
    expect(job.id).toBeTruthy();
    expect(job.digital_human_id).toBe(E2E_HUMAN_ID);

    const done = await pollJobStatus(job.id, "succeeded");
    expect(done.status).toBe("succeeded");
    expect(done.succeeded_stages).toContain("save_result");
  });

  it("restoreClient: fetchDefaultHuman returns the now-ready human", async () => {
    const result = await fetchDefaultHuman();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data?.id).toBe(E2E_HUMAN_ID);
      expect(result.data?.status).toBe("ready");
    }
  });

  it("restoreClient: a completed job is not resumable (data null)", async () => {
    const result = await fetchResumableBuildJob();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBeNull();
    }
  });

  it("cancels a running job, restore sees it resumable while running, then cleans it up", async () => {
    const { portraitPath, recordingPath } = makeMedia();
    const job = await createBuildJob({
      portraitPath,
      recordingPath,
      digitalHumanId: E2E_HUMAN_ID,
    });

    // Wait until the job is actually running so a cancel is a real cancel.
    await pollJobStatus(job.id, "running");

    // While running, restore reports it as a resumable unfinished job.
    const resume = await fetchResumableBuildJob();
    expect(resume.ok).toBe(true);
    if (resume.ok) {
      expect(resume.data?.id).toBe(job.id);
      expect(resume.data?.status).toBe("running");
    }

    const cancelling = await cancelBuildJob(job.id);
    expect(cancelling.status).toBe("cancelling");
    expect(cancelling.cancelled).toBe(true);

    const cancelled = await pollJobStatus(job.id, "cancelled");
    expect(cancelled.cancelled).toBe(true);
    expect(cancelled.completed_at).toBeTruthy();

    // A cancelled job is terminal -> not resumable.
    const after = await fetchResumableBuildJob();
    expect(after.ok).toBe(true);
    if (after.ok) {
      expect(after.data).toBeNull();
    }

    // Cleanup a cancelled job -> pending -> completes back to cancelled.
    const cleanup = await cleanupBuildJob(job.id);
    expect(cleanup.status).toBe("cleanup_pending");
    await pollJobStatus(job.id, "cancelled");
  });

  // The retry cycle (create -> validate_inputs fails -> retry -> succeeded)
  // traverses several real sidecar states; under full-suite load the default
  // 5s vitest timeout is too tight, so grant this test a longer budget.
  it("retries a failed build job after the media becomes available", async () => {
    const dir = mkdtempSync(join(tmpdir(), "e2e-retry-"));
    tempDirs.push(dir);
    const portraitPath = join(dir, "portrait.jpg");
    const recordingPath = join(dir, "recording.wav");
    // Recording exists but portrait is missing -> validate_inputs fails.
    writeFileSync(recordingPath, Buffer.from("recording"));
    const job = await createBuildJob({
      portraitPath,
      recordingPath,
      digitalHumanId: E2E_HUMAN_ID,
    });

    const failed = await pollJobStatus(job.id, "failed");
    expect(failed.error_code).toBe("media_missing");
    expect(failed.retry_count).toBe(0);

    // Now provide the portrait and retry -> the job succeeds.
    writeFileSync(portraitPath, Buffer.from("portrait"));
    const retried = await retryBuildJob(job.id);
    expect(retried.status).toBe("pending");
    expect(retried.retry_count).toBe(1);

    const succeeded = await pollJobStatus(job.id, "succeeded");
    expect(succeeded.status).toBe("succeeded");
  }, 30_000);

  it("manages digital humans: default, list, rename, switch default, honest delete", async () => {
    const def = await getDefaultDigitalHuman();
    expect(def?.id).toBe(E2E_HUMAN_ID);

    const humans = await listHumans();
    expect(humans.humans.some((h) => h.id === E2E_HUMAN_ID)).toBe(true);
    expect(humans.humans.some((h) => h.id === E2E_DELETE_HUMAN_ID)).toBe(true);

    const renamed = await renameHuman(E2E_HUMAN_ID, "E2E Renamed");
    expect(renamed.name).toBe("E2E Renamed");

    const switched = await setDefaultHuman(E2E_HUMAN_ID);
    expect(switched.is_default).toBe(true);

    // Honest-delete contract: the default human owns remote resources from the
    // succeeded build jobs, so deleting it is refused with 409 until its remote
    // resources are cleaned up. We assert the rejection rather than bypassing
    // the backend gate.
    await expect(deleteHuman(E2E_HUMAN_ID)).rejects.toMatchObject({ status: 409 });

    // A non-default human with no remote resources can be deleted directly.
    await deleteHuman(E2E_DELETE_HUMAN_ID);
    const after = await getDefaultDigitalHuman();
    expect(after?.id).toBe(E2E_HUMAN_ID);
  });

  it("manages conversations: create, list, get, rename, archive, unarchive, delete", async () => {
    const created = await createConversation("E2E Conversation");
    expect(created.id).toBeTruthy();
    expect(created.name).toBe("E2E Conversation");

    const listed = await listConversations();
    expect(listed.items.some((c) => c.id === created.id)).toBe(true);

    const detail = await getConversation(created.id);
    expect(detail.id).toBe(created.id);
    expect(Array.isArray(detail.messages)).toBe(true);

    await renameConversation(created.id, "Renamed E2E");
    const renamed = await getConversation(created.id);
    expect(renamed.name).toBe("Renamed E2E");

    await archiveConversation(created.id);
    const archived = await getConversation(created.id);
    expect(archived.archived).toBe(true);

    await unarchiveConversation(created.id);
    const unarchived = await getConversation(created.id);
    expect(unarchived.archived).toBe(false);

    await deleteConversation(created.id);
  });

  it("posts a plain reply through the real provider", async () => {
    const reply = await postConversationReply("hello");
    expect(reply.text).toBe("ready");
    expect(Array.isArray(reply.citations)).toBe(true);
  });

  it("streams a reply via real SSE (generation_started / token / done)", async () => {
    const generationIds: string[] = [];
    let tokens = "";
    let done = "";
    const events = {
      onGenerationStarted: (id: string) => generationIds.push(id),
      onToken: (text: string) => {
        tokens += text;
      },
      onDone: (text: string) => {
        done = text;
      },
    };

    await streamConversationReply({ query: "hello", events });

    expect(generationIds.length).toBeGreaterThan(0);
    expect(typeof generationIds[0]).toBe("string");
    expect(generationIds[0].length).toBeGreaterThan(0);
    expect(tokens.length).toBeGreaterThan(0);
    expect(done).toBe(tokens);
  });

  it("stops an active generation with a real generation_id", async () => {
    let generationId: string | null = null;
    const generationStarted = new Promise<string>((resolvePromise) => {
      streamConversationReply({
        query: "hello",
        events: {
          onGenerationStarted: (id) => {
            generationId = id;
            resolvePromise(id);
          },
        },
      }).catch(() => {
        // The stream may resolve as an error after stop; that is fine.
      });
    });

    const id = await generationStarted;
    expect(id).toBeTruthy();
    const stopped = await stopGenerating(id);
    expect(stopped).toBe(true);
  });
});