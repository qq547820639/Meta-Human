import { invoke } from "@tauri-apps/api/core";

interface SidecarConnection {
  readonly baseUrl: string;
  readonly bearerToken: string;
}

export interface ConversationMemory {
  readonly summary: string;
  readonly createdAt?: string | null;
}

export async function getConversationMemory(): Promise<ConversationMemory | null> {
  const connection = await invoke<SidecarConnection>("get_sidecar_connection");
  const response = await fetch(
    `${connection.baseUrl}/v1/conversation/memory`,
    {
      headers: {
        Authorization: `Bearer ${connection.bearerToken}`,
      },
      credentials: "omit",
      cache: "no-store",
    },
  );
  if (!response.ok) {
    throw new Error("无法读取长期记忆。");
  }
  const body = (await response.json()) as {
    summary?: string;
    created_at?: string | null;
  } | null;
  if (!body?.summary) {
    return null;
  }
  return {
    summary: body.summary,
    createdAt: body.created_at ?? null,
  };
}

export async function updateConversationMemory(
  summary: string,
): Promise<void> {
  const connection = await invoke<SidecarConnection>("get_sidecar_connection");
  const response = await fetch(
    `${connection.baseUrl}/v1/conversation/memory`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${connection.bearerToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ summary }),
      credentials: "omit",
      cache: "no-store",
    },
  );
  if (!response.ok) {
    throw new Error("无法更新长期记忆。");
  }
}

export async function clearConversationMemory(): Promise<void> {
  const connection = await invoke<SidecarConnection>("get_sidecar_connection");
  const response = await fetch(
    `${connection.baseUrl}/v1/conversation/memory`,
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
    throw new Error("无法清空长期记忆。");
  }
}
