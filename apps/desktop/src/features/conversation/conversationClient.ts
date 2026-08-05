import { invoke } from "@tauri-apps/api/core";

import { ApiError, apiRequest, toApiError } from "../../api/client";
import type { ApiErrorEnvelope } from "../../api/client";
import type {
  ConversationMessageData,
  ReplyData,
} from "../../api/contracts";

interface SidecarConnection {
  readonly baseUrl: string;
  readonly bearerToken: string;
}

/**
 * Conversation client. The raw response shapes come from the shared contracts
 * in `../../api/contracts.ts` (mirroring `routes/conversation.py`). The
 * exported reply/history types below are thin UI projections of `ReplyData`
 * and `ConversationMessageData`.
 */

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
    throw await toApiError(response);
  }
  const body = (await response.json()) as Partial<ReplyData>;
  return {
    text: body.text ?? "",
    citations: body.citations ?? [],
    grounded: body.grounded ?? false,
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
    throw await toApiError(response);
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
    throw await toApiError(response);
  }
  const body = (await response.json()) as {
    messages?: readonly Partial<ConversationMessageData>[];
  };
  return {
    messages: (body.messages ?? []).map((message) => ({
      role: message.role ?? "assistant",
      content: message.content ?? "",
      citations: message.citations ?? [],
      citationUrls: message.citation_urls ?? [],
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
    throw await toApiError(response);
  }
}

// ---------------------------------------------------------------------------
// Streaming replies (SSE via fetch + ReadableStream)
// ---------------------------------------------------------------------------

export type StreamStage = "understanding" | "retrieving";

export interface Citation {
  readonly id: string;
  readonly title: string;
  readonly type: string;
  readonly snippet?: string | null;
  readonly url?: string | null;
  readonly sourceUrl?: string | null;
  readonly updatedAt?: string | null;
}

export interface ConversationStreamEvents {
  readonly onGenerationStarted?: (generationId: string) => void;
  readonly onStage?: (stage: StreamStage) => void;
  readonly onFoundSources?: (count: number) => void;
  readonly onToken?: (text: string) => void;
  readonly onCitations?: (
    citations: Citation[],
    grounded: boolean,
    noBasis?: boolean,
  ) => void;
  readonly onDone?: (text: string) => void;
  readonly onAudio?: (audioBase64: string) => void;
  /**
   * Delivers a stream failure. Kept backward-compatible: `message` +
   * `retryable` are always provided, and the full `ApiError` (with
   * `requestId` / `recommendedAction` / `code` / `status`) is passed as the
   * optional third argument so callers can surface the unified error model.
   */
  readonly onError?: (
    message: string,
    retryable: boolean,
    error?: ApiError,
  ) => void;
}

export interface StreamConversationOptions {
  readonly query: string;
  readonly conversationId?: string | null;
  readonly regenerate?: boolean;
  readonly signal?: AbortSignal;
  readonly events?: ConversationStreamEvents;
}

/**
 * Consumes the NDJSON SSE stream for a reply. Events are dispatched through
 * `options.events` so the UI can update per phase. Resolves when the stream
 * ends; errors are delivered through `onError` rather than thrown.
 */
export async function streamConversationReply(
  options: StreamConversationOptions,
): Promise<void> {
  const connection = await invoke<SidecarConnection>("get_sidecar_connection");
  const response = await fetch(
    `${connection.baseUrl}/v1/conversation/replies/stream`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${connection.bearerToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: options.query,
        ...(options.conversationId
          ? { conversation_id: options.conversationId }
          : {}),
        ...(options.regenerate ? { regenerate: true } : {}),
      }),
      credentials: "omit",
      cache: "no-store",
      signal: options.signal,
    },
  );

  if (!response.ok || !response.body) {
    if (!response.ok) {
      // HTTP status abnormal: derive the full structured error from the body.
      const apiError = await toApiError(response);
      dispatchStreamError(options.events, apiError);
    } else {
      dispatchStreamError(
        options.events,
        new ApiError(
          streamErrorEnvelope({
            code: "stream_unavailable",
            message: "对话服务暂时无法回复。",
            retryable: true,
          }),
          response.status,
        ),
      );
    }
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        handleStreamLine(line, options.events);
      }
    }
    if (buffer.trim()) {
      handleStreamLine(buffer, options.events);
    }
  } catch (caught) {
    if (isAbortError(caught)) {
      options.events?.onError?.("已停止生成。", false);
    } else {
      // Mid-stream disconnect: generate the same unified ApiError.
      dispatchStreamError(
        options.events,
        new ApiError(
          streamErrorEnvelope({
            code: "stream_disconnected",
            message: "对话服务连接中断，请重试。",
            retryable: true,
            recommended_action: "请重试本次对话。",
          }),
          response.status,
        ),
      );
    }
  } finally {
    reader.releaseLock();
  }
}

/** Dispatches a complete `ApiError` through the backward-compatible callback. */
function dispatchStreamError(
  events: ConversationStreamEvents | undefined,
  apiError: ApiError,
): void {
  events?.onError?.(apiError.message, apiError.retryable, apiError);
}

/**
 * Builds a stream `ApiErrorEnvelope` from partial event fields, defaulting
 * missing values so the stream always yields a complete envelope.
 */
function streamErrorEnvelope(
  partial: Partial<ApiErrorEnvelope>,
  fallbackMessage = "对话服务暂时无法回复。",
): ApiErrorEnvelope {
  return {
    code:
      typeof partial.code === "string" && partial.code.length > 0
        ? partial.code
        : "stream_error",
    message:
      typeof partial.message === "string" && partial.message.length > 0
        ? partial.message
        : fallbackMessage,
    retryable:
      typeof partial.retryable === "boolean" ? partial.retryable : true,
    request_id:
      typeof partial.request_id === "string" ? partial.request_id : "",
    recommended_action:
      typeof partial.recommended_action === "string"
        ? partial.recommended_action
        : null,
    technical_message: partial.technical_message ?? null,
    details: partial.details ?? null,
    provider: partial.provider ?? null,
    provider_status: partial.provider_status ?? null,
    timestamp: partial.timestamp ?? null,
  };
}

function handleStreamLine(
  line: string,
  events?: ConversationStreamEvents,
): void {
  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }
  let payload = trimmed;
  let isDataEvent = false;
  if (payload.startsWith("data:")) {
    payload = payload.slice("data:".length).trim();
    isDataEvent = true;
  }
  if (!payload) {
    return;
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(payload) as Record<string, unknown>;
  } catch {
    // A line prefixed with `data:` that is not valid JSON is a contract
    // breach; leave the fallback path for unrecognized lines untouched.
    if (isDataEvent) {
      dispatchStreamError(
        events,
        new ApiError(
          streamErrorEnvelope({
            code: "parse_failed",
            message: "对话服务返回了无法解析的数据。",
            retryable: true,
            recommended_action: "请重试本次对话。",
          }),
          200,
        ),
      );
    }
    return;
  }

  switch (parsed.type) {
    case "generation_started": {
      if (typeof parsed.generation_id === "string") {
        events?.onGenerationStarted?.(parsed.generation_id);
      }
      break;
    }
    case "stage": {
      const stage = parsed.stage as StreamStage;
      if (stage === "understanding" || stage === "retrieving") {
        events?.onStage?.(stage);
      } else if (stage === "found_sources") {
        events?.onFoundSources?.(
          typeof parsed.count === "number" ? parsed.count : 0,
        );
      }
      break;
    }
    case "token": {
      if (typeof parsed.text === "string") {
        events?.onToken?.(parsed.text);
      }
      break;
    }
    case "citations": {
      const raw = parsed.citations;
      const citations = Array.isArray(raw)
        ? raw.map(normalizeCitation)
        : [];
      events?.onCitations?.(
        citations,
        parsed.grounded === true,
        parsed.no_basis === true,
      );
      break;
    }
    case "done": {
      if (typeof parsed.text === "string") {
        events?.onDone?.(parsed.text);
      }
      break;
    }
    case "audio": {
      if (typeof parsed.audio_base64 === "string") {
        events?.onAudio?.(parsed.audio_base64);
      }
      break;
    }
    case "error": {
      // SSE error event: parse the full structured error fields.
      const apiError = new ApiError(
        streamErrorEnvelope({
          code:
            typeof parsed.code === "string" ? parsed.code : undefined,
          message:
            typeof parsed.message === "string" ? parsed.message : undefined,
          retryable:
            typeof parsed.retryable === "boolean"
              ? parsed.retryable
              : undefined,
          request_id:
            typeof parsed.request_id === "string"
              ? parsed.request_id
              : undefined,
          recommended_action:
            typeof parsed.recommended_action === "string"
              ? parsed.recommended_action
              : undefined,
        }),
        200,
      );
      dispatchStreamError(events, apiError);
      break;
    }
  }
}

function normalizeCitation(raw: unknown): Citation {
  if (typeof raw === "string") {
    return { id: raw, title: raw, type: "source" };
  }
  const obj = (raw ?? {}) as Record<string, unknown>;
  const id =
    typeof obj.id === "string"
      ? obj.id
      : typeof obj.title === "string"
        ? obj.title
        : "";
  return {
    id: id || "source",
    title: typeof obj.title === "string" ? obj.title : id || "来源",
    type: typeof obj.type === "string" ? obj.type : "source",
    snippet: typeof obj.snippet === "string" ? obj.snippet : null,
    url: typeof obj.url === "string" ? obj.url : null,
    sourceUrl:
      typeof obj.sourceUrl === "string"
        ? obj.sourceUrl
        : typeof obj.source_url === "string"
          ? obj.source_url
          : null,
    updatedAt:
      typeof obj.updated_at === "string"
        ? obj.updated_at
        : typeof obj.updatedAt === "string"
          ? obj.updatedAt
          : null,
  };
}

function isAbortError(caught: unknown): boolean {
  return (
    typeof caught === "object" &&
    caught !== null &&
    "name" in caught &&
    caught.name === "AbortError"
  );
}

/**
 * Asks the sidecar to stop the current generation. Resolves with `true` when
 * the sidecar reports the generation was stopped, `false` otherwise.
 */
export async function stopGenerating(
  generationId: string,
): Promise<boolean> {
  const response = await apiRequest<{ stopped: boolean }>({
    method: "POST",
    path: "/v1/conversation/replies/stop",
    body: { generation_id: generationId },
  });
  return response.stopped === true;
}
