import { invoke } from "@tauri-apps/api/core";

import { toApiError } from "../../api/client";

interface SidecarConnection {
  readonly baseUrl: string;
  readonly bearerToken: string;
}

export interface KnowledgeSource {
  readonly documentId: string;
  readonly title: string;
  readonly sourceUrl?: string | null;
  readonly syncedAt?: string | null;
  readonly chunkCount: number;
  readonly enabled?: boolean;
  readonly status?: string;
  readonly freshness?: string;
  readonly syncProgress?: number;
  readonly syncStage?: string | null;
  readonly lastError?: string | null;
}

export interface KnowledgeSourcePage {
  readonly items: readonly KnowledgeSource[];
  readonly hasMore: boolean;
  readonly total: number;
}

export interface ListKnowledgeSourcesOptions {
  readonly limit?: number;
  readonly offset?: number;
}

interface RawKnowledgeSource {
  document_id: string;
  title: string;
  source_url?: string | null;
  synced_at?: string | null;
  chunk_count: number;
  enabled?: boolean;
  status?: string;
  freshness?: string;
  sync_progress?: number;
  sync_stage?: string | null;
  last_error?: string | null;
}

function normalizeSource(source: RawKnowledgeSource): KnowledgeSource {
  return {
    documentId: source.document_id,
    title: source.title,
    sourceUrl: source.source_url ?? null,
    syncedAt: source.synced_at ?? null,
    chunkCount: source.chunk_count,
    enabled: source.enabled !== false,
    status: source.status ?? "ready",
    freshness: source.freshness ?? "never",
    syncProgress: typeof source.sync_progress === "number" ? source.sync_progress : 0,
    syncStage: source.sync_stage ?? null,
    lastError: source.last_error ?? null,
  };
}

/**
 * Server-paginated knowledge sources. The sidecar returns `{sources, total,
 * has_more}` with `limit`/`offset`; this returns a single page plus the
 * metadata needed to drive a real "load more" request.
 */
export async function listKnowledgeSourcesPage(
  options: ListKnowledgeSourcesOptions = {},
): Promise<KnowledgeSourcePage> {
  const connection = await invoke<SidecarConnection>("get_sidecar_connection");
  const query = new URLSearchParams();
  if (typeof options.limit === "number") {
    query.set("limit", String(options.limit));
  }
  if (typeof options.offset === "number") {
    query.set("offset", String(options.offset));
  }
  const queryString = query.size > 0 ? `?${query.toString()}` : "";
  const response = await fetch(
    `${connection.baseUrl}/v1/knowledge/sources${queryString}`,
    {
      headers: {
        Authorization: `Bearer ${connection.bearerToken}`,
      },
      credentials: "omit",
      cache: "no-store",
    },
  );
  if (!response.ok) {
    throw await toApiError(response);
  }
  const body = (await response.json()) as {
    sources?: RawKnowledgeSource[];
    total?: number;
    has_more?: boolean;
  };
  const sources = Array.isArray(body.sources) ? body.sources : [];
  return {
    items: sources.map(normalizeSource),
    hasMore: body.has_more === true,
    total: typeof body.total === "number" ? body.total : sources.length,
  };
}

export async function listKnowledgeSources(): Promise<KnowledgeSource[]> {
  const page = await listKnowledgeSourcesPage();
  return [...page.items];
}

/** Enables (or pauses) a single knowledge source document. */
export async function setKnowledgeSourceEnabled(
  documentId: string,
  enabled: boolean,
): Promise<KnowledgeSource> {
  const connection = await invoke<SidecarConnection>("get_sidecar_connection");
  const response = await fetch(
    `${connection.baseUrl}/v1/knowledge/sources/${encodeURIComponent(documentId)}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${connection.bearerToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ enabled }),
      credentials: "omit",
      cache: "no-store",
    },
  );
  if (!response.ok) {
    throw await toApiError(response);
  }
  return normalizeSource((await response.json()) as RawKnowledgeSource);
}

/** Triggers an incremental resync of a single knowledge source document. */
export async function resyncKnowledgeSource(
  documentId: string,
): Promise<void> {
  const connection = await invoke<SidecarConnection>("get_sidecar_connection");
  const response = await fetch(
    `${connection.baseUrl}/v1/knowledge/sources/${encodeURIComponent(documentId)}/resync`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${connection.bearerToken}`,
      },
      credentials: "omit",
      cache: "no-store",
    },
  );
  if (!response.ok) {
    throw await toApiError(response);
  }
}

export async function deleteKnowledgeSource(
  documentId: string,
): Promise<void> {
  const connection = await invoke<SidecarConnection>("get_sidecar_connection");
  const response = await fetch(
    `${connection.baseUrl}/v1/knowledge/sources/${encodeURIComponent(documentId)}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${connection.bearerToken}`,
      },
      credentials: "omit",
      cache: "no-store",
    },
  );
  if (!response.ok) {
    throw await toApiError(response);
  }
}
