import { apiRequest } from "../../api/client";

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

interface RawHuman {
  readonly id?: unknown;
  readonly name?: unknown;
  readonly status?: unknown;
  readonly portrait_path?: unknown;
  readonly created_at?: unknown;
}

function normalizeHuman(body: RawHuman): DigitalHumanSummary {
  return {
    id: typeof body.id === "string" ? body.id : "",
    name: typeof body.name === "string" ? body.name : "",
    status: typeof body.status === "string" ? body.status : "",
    portraitPath:
      typeof body.portrait_path === "string" ? body.portrait_path : null,
    createdAt: typeof body.created_at === "string" ? body.created_at : null,
  };
}

interface RawConversation {
  readonly id?: unknown;
  readonly name?: unknown;
  readonly title?: unknown;
  readonly updated_at?: unknown;
  readonly archived?: unknown;
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
  const first = items[0] as RawConversation | undefined;
  if (!first || typeof first.id !== "string") {
    return null;
  }
  const title =
    typeof first.title === "string"
      ? first.title
      : typeof first.name === "string"
        ? first.name
        : first.id;
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
    const body = await apiRequest<RawHuman>({
      path: "/v1/avatar/humans/default",
    });
    return normalizeHuman(body);
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
 * null when none exists or the endpoint is unreachable.
 */
export async function fetchResumableBuildJob(): Promise<BuildJobSummary | null> {
  try {
    const body = await apiRequest<Partial<BuildJobSummary>>({
      path: "/v1/avatar/jobs/current",
    });
    if (typeof body.id !== "string") {
      return null;
    }
    return {
      id: body.id,
      status: body.status ?? "",
      stage: body.stage ?? null,
    };
  } catch {
    return null;
  }
}