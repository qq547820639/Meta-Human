import { apiRequest } from "../../api/client";
import type {
  BuildJobData,
  DigitalHumanData,
} from "../../api/contracts";

/**
 * Avatar build client.
 *
 * The primary creation path is driven by the sidecar build job API
 * (`/v1/avatar/jobs`), see `voxstudio_core/api/routes/avatar.py`. Build jobs
 * flow through authoritative job states (pending / running / succeeded /
 * failed / cancelling / cancelled / cleanup_pending / cleanup_failed), so the
 * UI never fakes progress and never cancels by aborting a local fetch.
 *
 * The avatar stream API (`/v1/avatar/streams`) is kept as-is: it is still
 * served by the backend and is used to start conversation with a digital
 * human avatar.
 */

export interface AvatarStreamResult {
  readonly sessionId: string;
  readonly streamUrl: string | null;
}

export interface CreateBuildJobInput {
  readonly portraitPath: string;
  readonly recordingPath: string;
  readonly idempotencyKey?: string;
  readonly digitalHumanId?: string;
  /**
   * Build intent. "new" creates a fresh human, "rebuild" replaces the remote
   * resources of `digitalHumanId` (updating the SAME record on success),
   * "copy" derives a new human from the given materials.
   */
  readonly mode?: "new" | "rebuild" | "copy";
}

/**
 * Stable idempotency key derived from the media paths. It is deliberately
 * NOT random: the same portrait + recording pair always maps to the same key,
 * so the backend can deduplicate a re-submission of the same material.
 */
export function buildIdempotencyKey(
  portraitPath: string,
  recordingPath: string,
): string {
  const source = `${portraitPath}\u0000${recordingPath}`;
  // FNV-1a 32-bit hash, rendered as a fixed-width hex string.
  let hash = 0x811c9dc5;
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `media-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * Stable digital-human id derived from the media paths. The backend exposes no
 * `POST /v1/avatar/humans` creation endpoint (verified against
 * `routes/avatar.py`), so the job is created with a prepared
 * `digital_human_id` that the backend then persists during the save stage.
 */
export function buildDigitalHumanId(
  portraitPath: string,
  recordingPath: string,
): string {
  // Reuse the same stable hash source so the id is deterministic per material.
  return `human-${buildIdempotencyKey(portraitPath, recordingPath)}`;
}

// --- Build jobs -----------------------------------------------------------------

/**
 * Creates a build job. Returns 202 with the authoritative `BuildJobResponse`.
 * The UI must poll `getBuildJob` until the job reaches a terminal state.
 */
export async function createBuildJob(
  input: CreateBuildJobInput,
): Promise<BuildJobData> {
  return apiRequest<BuildJobData>({
    method: "POST",
    path: "/v1/avatar/jobs",
    body: {
      portrait_path: input.portraitPath,
      recording_path: input.recordingPath,
      ...(input.idempotencyKey
        ? { idempotency_key: input.idempotencyKey }
        : {}),
      ...(input.digitalHumanId
        ? { digital_human_id: input.digitalHumanId }
        : {}),
      ...(input.mode ? { mode: input.mode } : {}),
    },
  });
}

export async function getBuildJob(
  jobId: string,
  signal?: AbortSignal,
): Promise<BuildJobData> {
  return apiRequest<BuildJobData>({
    path: `/v1/avatar/jobs/${encodeURIComponent(jobId)}`,
    signal,
  });
}

/** The most recent unfinished build job, if any. */
export async function getCurrentBuildJob(): Promise<BuildJobData | null> {
  return apiRequest<BuildJobData | null>({ path: "/v1/avatar/jobs/current" });
}

/** The most recent build job, including completed ones. */
export async function getRecentBuildJob(): Promise<BuildJobData | null> {
  return apiRequest<BuildJobData | null>({ path: "/v1/avatar/jobs/recent" });
}

/** Requests cancellation on the server; the job moves to a terminal state. */
export async function cancelBuildJob(jobId: string): Promise<BuildJobData> {
  return apiRequest<BuildJobData>({
    method: "POST",
    path: `/v1/avatar/jobs/${encodeURIComponent(jobId)}/cancel`,
  });
}

export async function retryBuildJob(jobId: string): Promise<BuildJobData> {
  return apiRequest<BuildJobData>({
    method: "POST",
    path: `/v1/avatar/jobs/${encodeURIComponent(jobId)}/retry`,
  });
}

export async function cleanupBuildJob(jobId: string): Promise<BuildJobData> {
  return apiRequest<BuildJobData>({
    method: "POST",
    path: `/v1/avatar/jobs/${encodeURIComponent(jobId)}/cleanup`,
  });
}

// --- Digital humans ------------------------------------------------------------

export async function getDefaultDigitalHuman(): Promise<DigitalHumanData | null> {
  return apiRequest<DigitalHumanData | null>({
    path: "/v1/avatar/humans/default",
  });
}

export async function getDigitalHuman(id: string): Promise<DigitalHumanData> {
  return apiRequest<DigitalHumanData>({
    path: `/v1/avatar/humans/${encodeURIComponent(id)}`,
  });
}

export async function listHumans(): Promise<DigitalHumanData[]> {
  return apiRequest<DigitalHumanData[]>({ path: "/v1/avatar/humans" });
}

export async function setDefaultHuman(id: string): Promise<DigitalHumanData> {
  return apiRequest<DigitalHumanData>({
    method: "PUT",
    path: `/v1/avatar/humans/${encodeURIComponent(id)}/default`,
  });
}

export async function renameHuman(
  id: string,
  name: string,
): Promise<DigitalHumanData> {
  return apiRequest<DigitalHumanData>({
    method: "PUT",
    path: `/v1/avatar/humans/${encodeURIComponent(id)}/name`,
    body: { name },
  });
}

export async function deleteHuman(id: string): Promise<void> {
  return apiRequest<void>({
    method: "DELETE",
    path: `/v1/avatar/humans/${encodeURIComponent(id)}`,
  });
}

// --- Avatar streams (kept; used to start conversation with a ready human) ------

export async function startAvatarStream(
  avatarId: string,
  voiceId: string,
): Promise<AvatarStreamResult> {
  const body = await apiRequest<{
    session_id: string;
    stream_url?: string | null;
  }>({
    method: "POST",
    path: "/v1/avatar/streams",
    body: { avatar_id: avatarId, voice_id: voiceId },
  });
  return {
    sessionId: body.session_id,
    streamUrl: body.stream_url ?? null,
  };
}

export async function stopAvatarStream(sessionId: string): Promise<void> {
  await apiRequest({
    method: "DELETE",
    path: `/v1/avatar/streams/${encodeURIComponent(sessionId)}`,
  });
}