import { ApiError, apiRequest } from "../../api/client";
import type {
  ConversationData,
  ConversationMessageData,
  ConversationMessagesData,
} from "../../api/contracts";

/**
 * Conversation management client. The raw response shapes come from the shared
 * contracts in `../../api/contracts.ts` (mirroring `routes/conversation.py`).
 * The exported `*` types below are thin UI-facing projections of those
 * contracts so the management UI stays stable.
 */

export interface ConversationSummary {
  readonly id: string;
  readonly name: string;
  readonly updatedAt?: string | null;
  readonly archived?: boolean;
}

export interface ConversationMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly citations?: readonly string[];
  readonly citationUrls?: readonly (string | null)[];
  readonly grounded?: boolean;
  readonly createdAt?: string | null;
}

export interface ConversationDetail extends ConversationSummary {
  readonly messages: readonly ConversationMessage[];
}

export interface ConversationMessagesPage {
  readonly messages: readonly ConversationMessage[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

/**
 * A server-paginated page of conversations. `items` holds a single page
 * (``limit`` items), `hasMore` tells the UI whether another page exists, and
 * `total` is the total number of matching conversations across all pages.
 */
export interface ConversationListPage {
  readonly items: readonly ConversationSummary[];
  readonly hasMore: boolean;
  readonly total: number;
}

export interface ConversationListOptions {
  readonly limit?: number;
  readonly offset?: number;
  readonly archived?: "any" | "active" | "archived";
  readonly signal?: AbortSignal;
}

type RawConversation = Partial<ConversationData>;
type RawMessage = Partial<ConversationMessageData>;

function normalizeSummary(raw: RawConversation): ConversationSummary {
  const title = typeof raw.title === "string" ? raw.title : "";
  return {
    id: typeof raw.id === "string" ? raw.id : "",
    name: title,
    updatedAt: typeof raw.updated_at === "string" ? raw.updated_at : null,
    archived: typeof raw.archived === "boolean" ? raw.archived : undefined,
  };
}

function parseList(body: unknown): readonly ConversationSummary[] {
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
  return items
    .filter((item): item is RawConversation => {
      return (
        typeof item === "object" &&
        item !== null &&
        typeof (item as RawConversation).id === "string"
      );
    })
    .map(normalizeSummary);
}

function parseMessages(raw: unknown): readonly ConversationMessage[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .filter((item): item is RawMessage => {
      return typeof item === "object" && item !== null;
    })
    .map((item) => ({
      role: item.role === "user" ? "user" : "assistant",
      content: typeof item.content === "string" ? item.content : "",
      citations: Array.isArray(item.citations)
        ? item.citations.filter((c): c is string => typeof c === "string")
        : undefined,
      citationUrls: Array.isArray(item.citation_urls)
        ? item.citation_urls.filter(
            (c): c is string | null => c === null || typeof c === "string",
          )
        : undefined,
      grounded: typeof item.grounded === "boolean" ? item.grounded : undefined,
      createdAt:
        typeof item.created_at === "string" ? item.created_at : null,
    }));
}

export async function listConversations(
  options: ConversationListOptions = {},
): Promise<ConversationListPage> {
  const body = await apiRequest<{
    conversations?: unknown[];
    has_more?: boolean;
    total?: number;
  }>({
    path: "/v1/conversations",
    query: {
      limit: options.limit,
      offset: options.offset,
      archived: options.archived,
    },
    signal: options.signal,
  });
  const items = parseList(body);
  return {
    items,
    hasMore: body.has_more === true,
    total: typeof body.total === "number" ? body.total : items.length,
  };
}

export async function searchConversations(
  query: string,
  options: Omit<ConversationListOptions, "archived"> = {},
): Promise<ConversationListPage> {
  const body = await apiRequest<{
    conversations?: unknown[];
    has_more?: boolean;
    total?: number;
  }>({
    path: "/v1/conversations/search",
    query: { q: query, limit: options.limit, offset: options.offset },
    signal: options.signal,
  });
  const items = parseList(body);
  return {
    items,
    hasMore: body.has_more === true,
    total: typeof body.total === "number" ? body.total : items.length,
  };
}

export async function createConversation(
  title?: string,
): Promise<ConversationSummary> {
  const body = await apiRequest<RawConversation>({
    method: "POST",
    path: "/v1/conversations",
    body: title ? { title } : undefined,
  });
  return normalizeSummary(body);
}

export async function getConversation(
  id: string,
  options: { limit?: number; signal?: AbortSignal } = {},
): Promise<ConversationDetail> {
  const body = await apiRequest<RawConversation>({
    path: `/v1/conversations/${encodeURIComponent(id)}`,
    signal: options.signal,
  });
  const page = await listConversationMessages(id, {
    limit: options.limit ?? 200,
    signal: options.signal,
  });
  return {
    ...normalizeSummary(body),
    messages: page.messages,
  };
}

export async function listConversationMessages(
  id: string,
  options: { limit?: number; cursor?: string | null; signal?: AbortSignal } = {},
): Promise<ConversationMessagesPage> {
  const body = await apiRequest<Partial<ConversationMessagesData>>({
    path: `/v1/conversations/${encodeURIComponent(id)}/messages`,
    query: {
      limit: options.limit,
      cursor: options.cursor ?? undefined,
    },
    signal: options.signal,
  });
  // The messages contract is load-bearing: a missing `messages` array means
  // the conversation has no messages OR the contract drifted. We must not
  // silently fall back to an empty list, otherwise empty conversations would
  // mask a real contract break.
  if (!Array.isArray(body.messages)) {
    throw new ApiError(
      {
        code: "invalid_response",
        message: "对话消息接口返回格式异常，请检查服务版本。",
        retryable: false,
        request_id: "",
        recommended_action: "请检查服务版本后重试。",
      },
      0,
    );
  }
  return {
    messages: parseMessages(body.messages),
    nextCursor: typeof body.next_cursor === "string" ? body.next_cursor : null,
    hasMore: body.has_more === true,
  };
}

export async function renameConversation(
  id: string,
  name: string,
): Promise<void> {
  await apiRequest({
    method: "PATCH",
    path: `/v1/conversations/${encodeURIComponent(id)}`,
    body: { title: name },
  });
}

export async function archiveConversation(id: string): Promise<void> {
  await apiRequest({
    method: "POST",
    path: `/v1/conversations/${encodeURIComponent(id)}/archive`,
    body: { archived: true },
  });
}

export async function unarchiveConversation(id: string): Promise<void> {
  await apiRequest({
    method: "POST",
    path: `/v1/conversations/${encodeURIComponent(id)}/archive`,
    body: { archived: false },
  });
}

export async function deleteConversation(id: string): Promise<void> {
  await apiRequest({
    method: "DELETE",
    path: `/v1/conversations/${encodeURIComponent(id)}`,
  });
}

export async function clearConversationMessages(id: string): Promise<void> {
  await apiRequest({
    method: "POST",
    path: `/v1/conversations/${encodeURIComponent(id)}/clear`,
  });
}