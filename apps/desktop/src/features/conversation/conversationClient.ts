import { invoke } from "@tauri-apps/api/core";

interface SidecarConnection {
  readonly baseUrl: string;
  readonly bearerToken: string;
}

export interface ConversationReply {
  readonly text: string;
  readonly citations: readonly string[];
  readonly grounded: boolean;
  readonly audioBase64?: string | null;
  readonly citationUrls?: readonly (string | null)[];
}

export interface ConversationHistoryMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly citations?: readonly string[];
  readonly citationUrls?: readonly (string | null)[];
  readonly grounded?: boolean;
  readonly createdAt?: string | null;
}

export interface ConversationHistory {
  readonly messages: ConversationHistoryMessage[];
}

export async function postConversationReply(
  query: string,
  signal?: AbortSignal,
  regenerate = false,
): Promise<ConversationReply> {
  const connection = await invoke<SidecarConnection>("get_sidecar_connection");
  const response = await fetch(
    `${connection.baseUrl}/v1/conversation/replies`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${connection.bearerToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, regenerate }),
      credentials: "omit",
      cache: "no-store",
      signal,
    },
  );
  if (!response.ok) {
    throw new Error("对话服务暂时无法回复。");
  }
  const body = (await response.json()) as {
    text: string;
    citations: readonly string[];
    grounded: boolean;
    audio_base64?: string | null;
    citation_urls?: readonly (string | null)[];
  };
  return {
    text: body.text,
    citations: body.citations,
    grounded: body.grounded,
    audioBase64: body.audio_base64 ?? null,
    citationUrls: body.citation_urls ?? [],
  };
}

export async function transcribeRecording(
  audioPath: string,
): Promise<string> {
  const connection = await invoke<SidecarConnection>("get_sidecar_connection");
  const response = await fetch(
    `${connection.baseUrl}/v1/conversation/transcribe`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${connection.bearerToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ audio_path: audioPath }),
      credentials: "omit",
      cache: "no-store",
    },
  );
  if (!response.ok) {
    throw new Error("语音识别暂时不可用。");
  }
  const body = (await response.json()) as { text: string };
  return body.text;
}

export async function listConversationHistory(): Promise<ConversationHistory> {
  const connection = await invoke<SidecarConnection>("get_sidecar_connection");
  const response = await fetch(
    `${connection.baseUrl}/v1/conversation/history`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${connection.bearerToken}`,
      },
      credentials: "omit",
      cache: "no-store",
    },
  );
  if (!response.ok) {
    throw new Error("无法读取对话历史。");
  }
  const body = (await response.json()) as {
    messages: {
      role: "user" | "assistant";
      content: string;
      citations?: readonly string[];
      citation_urls?: readonly (string | null)[];
      grounded?: boolean;
      created_at?: string | null;
    }[];
  };
  return {
    messages: body.messages.map((message) => ({
      role: message.role,
      content: message.content,
      citations: message.citations,
      citationUrls: message.citation_urls,
      grounded: message.grounded,
      createdAt: message.created_at ?? null,
    })),
  };
}

export async function clearConversationHistory(): Promise<void> {
  const connection = await invoke<SidecarConnection>("get_sidecar_connection");
  const response = await fetch(
    `${connection.baseUrl}/v1/conversation/history`,
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
    throw new Error("无法清空对话历史。");
  }
}
