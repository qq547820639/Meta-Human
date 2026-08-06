import { ApiError, apiRequest } from "../../api/client";
import type {
  BuildJobData,
  ConversationData,
  DigitalHumanData,
} from "../../api/contracts";

/**
 * Restore client. The raw response shapes come from the shared contracts in
 * `../../api/contracts.ts` (which mirror the backend Pydantic models in
 * `voxstudio_core/api/routes/*.py`). The exported `*Summary` types are thin
 * UI-facing projections of those contracts so the restore view stays stable.
 *
 * Every fetch returns a structured `RestoreFetchResult` so callers can tell
 * "no data" apart from "sidecar down / auth failed / parse failed / db error".
 * Errors are never silently swallowed.
 */

/** Reasons a restore fetch can fail. */
export type RestoreErrorKind =
  | "sidecar_unreachable"
  | "auth_failed"
  | "parse_failed"
  | "database_error"
  | "network";

/** Structured result of a restore fetch: `ok: true` with (possibly null) data,
 * or `ok: false` with a failure reason. */
export type RestoreFetchResult<T> =
  | { ok: true; data: T | null }
  | { ok: false; error: RestoreErrorKind };

export interface DigitalHumanSummary {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly portraitPath?: string | null;
  readonly avatarId?: string | null;
  readonly voiceId?: string | null;
  readonly createdAt?: string | null;
}

export interface ConversationSummary {
  readonly id: string;
  readonly name: string;
  readonly updatedAt?: string | null;
  readonly archived?: boolean;
}

export interface BuildJobSummary {
  readonly id: string;
  readonly status: string;
  readonly stage?: string | null;
  readonly stageProgress?: string | null;
  readonly succeededStages?: readonly string[];
  readonly retryCount?: number;
  readonly errorCode?: string | null;
  readonly errorDetail?: string | null;
  readonly cancelled?: boolean;
  readonly updatedAt?: string | null;
  readonly createdAt?: string | null;
  readonly completedAt?: string | null;
}

function isReadyStatus(status: string): boolean {
  return status === "ready" || status === "completed";
}

/** True when a digital human exists and is ready to resume conversation. */
export function isHumanReady(
  human: DigitalHumanSummary | null,
): boolean {
  return human !== null && isReadyStatus(human.status);
}

/**
 * Classifies an error thrown by `apiRequest` into a `RestoreErrorKind`.
 * `ApiError` carries the HTTP status; network / parse failures surface as
 * built-in `TypeError` / `SyntaxError`; anything else (e.g. the sidecar
 * connection invoke failing) is treated as the sidecar being unreachable.
 */
function classifyError(err: unknown): RestoreErrorKind {
  if (err instanceof ApiError) {
    if (err.status === 401 || err.status === 403) {
      return "auth_failed";
    }
    if (err.status >= 500) {
      return "database_error";
    }
    return "network";
  }
  if (err instanceof TypeError) {
    return "sidecar_unreachable";
  }
  if (err instanceof SyntaxError) {
    return "parse_failed";
  }
  return "sidecar_unreachable";
}

/**
 * Normalizes a `DigitalHumanResponse` (snake_case) into the UI projection.
 * The backend reports readiness via `creation_status`, not `status`.
 */
function normalizeHuman(body: Partial<DigitalHumanData>): DigitalHumanSummary {
  return {
    id: body.id ?? "",
    name: body.name ?? "",
    status: body.creation_status ?? "",
    portraitPath: body.portrait_path ?? null,
    avatarId: body.avatar_id ?? null,
    voiceId: body.voice_id ?? null,
    createdAt: body.created_at ?? null,
  };
}

/**
 * Normalizes a `BuildJobResponse` (snake_case) into the UI projection. The
 * current stage is reported via `current_stage`; the restore card also needs
 * `succeeded_stages`, `updated_at`, `error_code`, `error_detail` and
 * `cancelled`.
 */
export function normalizeJob(body: Partial<BuildJobData>): BuildJobSummary {
  return {
    id: body.id ?? "",
    status: body.status ?? "",
    stage: body.current_stage ?? null,
    stageProgress: body.stage_progress ?? null,
    succeededStages: body.succeeded_stages ?? [],
    retryCount: typeof body.retry_count === "number" ? body.retry_count : 0,
    errorCode: body.error_code ?? null,
    errorDetail: body.error_detail ?? null,
    cancelled: body.cancelled ?? false,
    updatedAt: body.updated_at ?? null,
    createdAt: body.created_at ?? null,
    completedAt: body.completed_at ?? null,
  };
}

/** Build job statuses that mean the build has finished and is not resumable. */
const TERMINAL_JOB_STATUSES: ReadonlySet<string> = new Set([
  "succeeded",
  "cancelled",
]);

function isJobResumable(status: string): boolean {
  return !TERMINAL_JOB_STATUSES.has(status);
}

function firstConversation(body: unknown): ConversationSummary | null {
  let items: unknown[] = [];
  if (Array.isArray(body)) {
    items = body;
  } else if (body && typeof body === "object") {
    const candidate = (body as { conversations?: unknown }).conversations;
    if (Array.isArray(candidate)) {
      items = candidate;
    } else {
      const nested = (body as { items?: unknown }).items;
      if (Array.isArray(nested)) {
        items = nested;
      }
    }
  }
  const first = items[0] as Partial<ConversationData> | undefined;
  if (!first || typeof first.id !== "string") {
    return null;
  }
  const title = typeof first.title === "string" ? first.title : first.id;
  return {
    id: first.id,
    name: title,
    updatedAt: typeof first.updated_at === "string" ? first.updated_at : null,
    archived: typeof first.archived === "boolean" ? first.archived : undefined,
  };
}

/**
 * Fetches the default digital human. Returns `ok: true` with `data: null`
 * when none exists (or the endpoint 404s), or `ok: false` with a failure
 * reason when the endpoint could not be reached.
 */
export async function fetchDefaultHuman(): Promise<
  RestoreFetchResult<DigitalHumanSummary>
> {
  try {
    const body = await apiRequest<Partial<DigitalHumanData>>({
      path: "/v1/avatar/humans/default",
    });
    return { ok: true, data: body === null ? null : normalizeHuman(body) };
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      return { ok: true, data: null };
    }
    return { ok: false, error: classifyError(err) };
  }
}

/**
 * Fetches the most recent conversation. Returns `ok: true` with `data: null`
 * when there is none (or the endpoint 404s), or `ok: false` with a failure
 * reason otherwise.
 */
export async function fetchRecentConversation(): Promise<
  RestoreFetchResult<ConversationSummary>
> {
  try {
    const body = await apiRequest<unknown>({
      path: "/v1/conversations",
      query: { limit: 1 },
    });
    return { ok: true, data: firstConversation(body) };
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      return { ok: true, data: null };
    }
    return { ok: false, error: classifyError(err) };
  }
}

/**
 * Fetches an unfinished build job, if any, so the user can resume it. A
 * completed job (status `succeeded` / `cancelled`) or a 404 is treated as
 * "no unfinished task" (`data: null`). Returns `ok: false` with a failure
 * reason when the endpoint is unreachable.
 */
export async function fetchResumableBuildJob(): Promise<
  RestoreFetchResult<BuildJobSummary>
> {
  try {
    const body = await apiRequest<Partial<BuildJobData>>({
      path: "/v1/avatar/jobs/current",
    });
    if (
      body === null ||
      typeof body.id !== "string" ||
      !isJobResumable(body.status ?? "")
    ) {
      return { ok: true, data: null };
    }
    return { ok: true, data: normalizeJob(body) };
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      return { ok: true, data: null };
    }
    return { ok: false, error: classifyError(err) };
  }
}
