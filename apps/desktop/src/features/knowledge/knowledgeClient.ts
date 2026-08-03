import { invoke } from "@tauri-apps/api/core";

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
}

export async function listKnowledgeSources(): Promise<KnowledgeSource[]> {
  const connection = await invoke<SidecarConnection>("get_sidecar_connection");
  const response = await fetch(`${connection.baseUrl}/v1/knowledge/sources`, {
    headers: {
      Authorization: `Bearer ${connection.bearerToken}`,
    },
    credentials: "omit",
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error("无法读取知识来源。");
  }
  const body = (await response.json()) as {
    sources: {
      document_id: string;
      title: string;
      source_url?: string | null;
      synced_at?: string | null;
      chunk_count: number;
    }[];
  };
  return body.sources.map((source) => ({
    documentId: source.document_id,
    title: source.title,
    sourceUrl: source.source_url ?? null,
    syncedAt: source.synced_at ?? null,
    chunkCount: source.chunk_count,
  }));
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
    throw new Error("无法删除知识来源。");
  }
}
