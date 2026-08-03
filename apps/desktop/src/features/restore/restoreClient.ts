import { apiRequest } from "../../api/client";
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
 */

export interface DigitalHumanSummary {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly portraitPath?: string | null;
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
 * Normalizes a `DigitalHumanResponse` (snake_case) into the UI projection.
 * The backend reports readiness via `creation_status`, not `status`.
 */
function normalizeHuman(body: Partial<DigitalHumanData>): DigitalHumanSummary {
  return {
    id: body.id ?? "",
    name: body.name ?? "",
    status: body.creation_status ?? "",
    portraitPath: body.portrait_path ?? null,
    createdAt: body.created_at ?? null,
  };
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
 * Fetches the default digital human. Returns null when the endpoint is
 * unreachable so the app can fall back to the normal startup flow.
 */
export async function fetchDefaultHuman(): Promise<DigitalHumanSummary | null> {
  try {
    const body = await apiRequest<Partial<DigitalHumanData>>({
      path: "/v1/avatar/humans/default",
    });
    return body === null ? null : normalizeHuman(body);
  } catch {
    return null;
  }
}

/**
 * Fetches the most recent conversation. Returns null when there is none or
 * when the endpoint is unreachable.
 */
export async function fetchRecentConversation(): Promise<ConversationSummary | null> {
  try {
    const body = await apiRequest<unknown>({
      path: "/v1/conversations",
      query: { limit: 1 },
    });
    return firstConversation(body);
  } catch {
    return null;
  }
}

/**
 * Fetches an unfinished build job, if any, so the user can resume it. Returns
 * null when none exists or the endpoint is unreachable. The raw shape is the
 * `BuildJobResponse` contract; the current stage is reported via
 * `current_stage`.
 */
export async function fetchResumableBuildJob(): Promise<BuildJobSummary | null> {
  try {
    const body = await apiRequest<Partial<BuildJobData>>({
      path: "/v1/avatar/jobs/current",
    });
    if (body === null || typeof body.id !== "string") {
      return null;
    }
    return {
      id: body.id,
      status: body.status ?? "",
      stage: body.current_stage ?? null,
    };
  } catch {
    return null;
  }
}