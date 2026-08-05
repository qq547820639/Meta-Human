import { ApiError } from "../../api/client";
import type { Citation } from "./conversationClient";
import type { ConversationMessage } from "./conversationManagementClient";

/** A single message in the conversation timeline (client-side id space). */
export interface ChatMessage {
  readonly id: number;
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly createdAt?: string;
  readonly citations?: readonly Citation[];
  readonly grounded?: boolean;
  readonly audioBase64?: string | null;
  /** True when this assistant reply was produced by regenerating or editing. */
  readonly regenerated?: boolean;
}

/**
 * A user-facing error with the unified API error fields. Stream errors only
 * carry `message` + `retryable`; HTTP errors from the unified client also
 * carry `requestId` and `recommendedAction`.
 */
export interface ChatError {
  readonly message: string;
  readonly retryable: boolean;
  readonly requestId?: string;
  readonly recommendedAction?: string | null;
}

export const suggestedQuestions = [
  "我的数字人是怎么创建的？",
  "你能从我的知识里找到什么？",
  "今天可以帮我做什么？",
];

/** How many messages are rendered at once; older ones load on demand. */
export const INITIAL_VISIBLE_COUNT = 50;
export const PAGE_STEP = 50;
export const SCROLL_BOTTOM_THRESHOLD = 48;
export const TITLE_MAX_LENGTH = 18;

export function conversationMessageToCitations(
  citations: readonly string[] | undefined,
): readonly Citation[] | undefined {
  if (!citations || citations.length === 0) {
    return undefined;
  }
  return citations.map((citation) => ({
    id: citation,
    title: citation,
    type: "source",
  }));
}

export function serverMessageToChat(
  message: ConversationMessage,
  id: number,
): ChatMessage {
  return {
    id,
    role: message.role,
    text: message.content,
    createdAt: message.createdAt ?? undefined,
    citations: conversationMessageToCitations(message.citations),
    grounded: message.grounded,
  };
}

/** Derives a short conversation title from the first user question. */
export function buildTitleFromQuestion(question: string): string {
  const cleaned = question.replace(/\s+/g, " ").trim();
  if (cleaned.length <= TITLE_MAX_LENGTH) {
    return cleaned;
  }
  return `${cleaned.slice(0, TITLE_MAX_LENGTH)}…`;
}

export function isAbortError(caught: unknown): boolean {
  return caught instanceof Error && caught.name === "AbortError";
}

export function toChatError(caught: unknown, fallback: string): ChatError {
  if (caught instanceof ApiError) {
    return {
      message: caught.message,
      retryable: caught.retryable,
      requestId: caught.requestId || undefined,
      recommendedAction: caught.recommendedAction,
    };
  }
  return { message: fallback, retryable: true };
}