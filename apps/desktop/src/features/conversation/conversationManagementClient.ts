import { apiRequest } from "../../api/client";

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

interface RawConversation {
  readonly id?: unknown;
  readonly title?: unknown;
  readonly name?: unknown;
  readonly updated_at?: unknown;
  readonly archived?: unknown;
}

function normalizeSummary(raw: RawConversation): ConversationSummary {
  const title =
    typeof raw.title === "string"
      ? raw.title
      : typeof raw.name === "string"
        ? raw.name
        : "";
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
    .filter((item): item is Record<string, unknown> => {
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

export async function listConversations(): Promise<readonly ConversationSummary[]> {
  const body = await apiRequest<unknown>({ path: "/v1/conversations" });
  return parseList(body);
}

export async function searchConversations(
  query: string,
): Promise<readonly ConversationSummary[]> {
  const body = await apiRequest<unknown>({
    path: "/v1/conversations/search",
    query: { q: query },
  });
  return parseList(body);
}

export async function createConversation(
  name?: string,
): Promise<ConversationSummary> {
  const body = await apiRequest<RawConversation>({
    method: "POST",
    path: "/v1/conversations",
    body: name ? { name } : undefined,
  });
  return normalizeSummary(body);
}

export async function getConversation(
  id: string,
): Promise<ConversationDetail> {
  const body = await apiRequest<RawConversation & { messages?: unknown }>({
    path: `/v1/conversations/${encodeURIComponent(id)}`,
  });
  return {
    ...normalizeSummary(body),
    messages: parseMessages(body.messages),
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