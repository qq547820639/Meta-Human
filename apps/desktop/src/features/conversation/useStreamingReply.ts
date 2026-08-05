import { useEffect, useRef } from "react";

import {
  Citation,
  stopGenerating,
  streamConversationReply,
} from "./conversationClient";
import { renameConversation } from "./conversationManagementClient";
import type { ConversationMetrics } from "./conversationMetrics";
import type { ConversationUiAction } from "./conversationStateMachine";
import {
  buildTitleFromQuestion,
  isAbortError,
  toChatError,
  type ChatError,
  type ChatMessage,
} from "./conversationModel";

export interface UseStreamingReplyDeps {
  readonly dispatch: React.Dispatch<ConversationUiAction>;
  readonly setMessages: (updater: (m: ChatMessage[]) => ChatMessage[]) => void;
  readonly setError: (error: ChatError | null) => void;
  readonly setQuery: (query: string) => void;
  readonly setStreaming: (value: boolean) => void;
  readonly setSourcesCount: (value: number) => void;
  readonly getConversationId: () => string | null;
  readonly needsTitleRef: React.MutableRefObject<boolean>;
  /** Receives latency metrics measured during the reply pipeline. */
  readonly onMetrics?: (metrics: Partial<ConversationMetrics>) => void;
}

export interface UseStreamingReplyResult {
  readonly send: (
    overrideQuery?: string,
    appendUser?: boolean,
    regenerate?: boolean,
    markRegenerated?: boolean,
  ) => Promise<void>;
  readonly stop: () => Promise<void>;
  readonly lastQuery: () => string | null;
  readonly abortInFlight: () => void;
}

/**
 * Encapsulates the single reply pipeline: sends the query, streams tokens
 * through a requestAnimationFrame-throttled buffer into the assistant message,
 * and dispatches the generation / tts dimensions of the state machine. Stop
 * aborts the stream and asks the server to cancel the generation; any late
 * onAudio event is ignored once stopped.
 */
export function useStreamingReply({
  dispatch,
  setMessages,
  setError,
  setQuery,
  setStreaming,
  setSourcesCount,
  getConversationId,
  needsTitleRef,
  onMetrics,
}: UseStreamingReplyDeps): UseStreamingReplyResult {
  const sendStartRef = useRef(0);
  const nextId = useRef(0);
  const lastQueryRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const generationIdRef = useRef<string | null>(null);
  const stoppedRef = useRef(false);
  const buildingRef = useRef("");
  const assistantIdRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  function appendMessage(message: Omit<ChatMessage, "id">) {
    nextId.current += 1;
    setMessages((current) => [
      ...current,
      {
        ...message,
        id: nextId.current,
        createdAt: new Date().toISOString(),
      },
    ]);
  }

  function flushTokenBuffer() {
    rafRef.current = null;
    const id = assistantIdRef.current;
    if (id === null) {
      return;
    }
    const text = buildingRef.current;
    setMessages((current) =>
      current.map((message) =>
        message.id === id ? { ...message, text } : message,
      ),
    );
  }

  function scheduleTokenFlush() {
    if (rafRef.current !== null) {
      return;
    }
    rafRef.current = requestAnimationFrame(() => {
      flushTokenBuffer();
    });
  }

  function cancelTokenFlush() {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }

  async function send(
    overrideQuery?: string,
    appendUser = true,
    regenerate = false,
    markRegenerated = false,
  ): Promise<void> {
    const trimmed = (overrideQuery ?? "").trim();
    if (!trimmed) {
      setError({ message: "请先输入一个问题。", retryable: false });
      return;
    }
    setError(null);
    stoppedRef.current = false;
    lastQueryRef.current = trimmed;
    sendStartRef.current = performance.now();
    if (appendUser) {
      appendMessage({ role: "user", text: trimmed });
    }
    setQuery("");
    setStreaming(true);
    dispatch({ type: "GENERATION_START" });

    // Best-effort title for a brand-new conversation (first user question).
    if (needsTitleRef.current) {
      needsTitleRef.current = false;
      const conversationId = getConversationId();
      if (conversationId) {
        const title = buildTitleFromQuestion(trimmed);
        void renameConversation(conversationId, title).catch(() => {
          // Title generation is cosmetic; failing to persist it must not block
          // the conversation.
        });
      }
    }

    const controller = new AbortController();
    abortRef.current = controller;
    generationIdRef.current = null;
    assistantIdRef.current = null;
    buildingRef.current = "";
    cancelTokenFlush();

    let citations: Citation[] = [];
    let grounded = false;
    let noBasis = false;
    let generating = false;

    try {
      await streamConversationReply({
        query: trimmed,
        conversationId: getConversationId(),
        regenerate,
        signal: controller.signal,
        events: {
          onGenerationStarted: (generationId) => {
            generationIdRef.current = generationId;
          },
          onStage: (stage) =>
            dispatch({ type: "GENERATION_STAGE", stage }),
          onFoundSources: (count) => {
            setSourcesCount(count);
            dispatch({ type: "SOURCES_FOUND" });
          },
          onToken: (text) => {
            buildingRef.current += text;
            if (!generating) {
              generating = true;
              onMetrics?.({ firstCharMs: performance.now() - sendStartRef.current });
              dispatch({ type: "TOKEN_STARTED" });
            }
            if (assistantIdRef.current === null) {
              assistantIdRef.current = nextId.current + 1;
              nextId.current += 1;
              setMessages((current) => [
                ...current,
                {
                  id: assistantIdRef.current!,
                  role: "assistant",
                  text: buildingRef.current,
                  regenerated: markRegenerated,
                },
              ]);
            } else {
              scheduleTokenFlush();
            }
          },
          onCitations: (nextCitations, nextGrounded, nextNoBasis) => {
            citations = nextCitations;
            grounded = nextGrounded;
            noBasis = nextNoBasis ?? false;
          },
          onDone: (text) => {
            cancelTokenFlush();
            onMetrics?.({ fullResponseMs: performance.now() - sendStartRef.current });
            dispatch({ type: "GENERATION_DONE" });
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantIdRef.current
                  ? {
                      ...message,
                      text,
                      citations,
                      grounded,
                      noBasis,
                      regenerated: markRegenerated,
                    }
                  : message,
              ),
            );
          },
          onAudio: (audioBase64) => {
            if (stoppedRef.current || !mountedRef.current) {
              return;
            }
            dispatch({ type: "TTS_READY" });
            const id = assistantIdRef.current;
            if (id === null) {
              return;
            }
            setMessages((current) =>
              current.map((message) =>
                message.id === id ? { ...message, audioBase64 } : message,
              ),
            );
          },
          onError: (message, retryable, apiError) => {
            setError({
              message,
              retryable,
              requestId: apiError?.requestId || undefined,
              recommendedAction: apiError?.recommendedAction ?? null,
            });
            dispatch({ type: "GENERATION_ERROR" });
            setQuery(trimmed);
          },
        },
      });
    } catch (caught) {
      if (isAbortError(caught)) {
        setError({ message: "已停止生成。", retryable: false });
        setQuery(trimmed);
      } else {
        setError(toChatError(caught, "对话服务暂时无法回复。"));
        setQuery(trimmed);
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
      setStreaming(false);
    }
  }

  async function stop(): Promise<void> {
    stoppedRef.current = true;
    abortRef.current?.abort();
    const generationId = generationIdRef.current;
    if (!generationId) {
      setError({
        message: "无法停止生成：尚未收到生成标识，请稍后重试。",
        retryable: false,
      });
      return;
    }
    dispatch({ type: "GENERATION_STOPPED" });
    try {
      const stopped = await stopGenerating(generationId);
      if (stopped) {
        setError({ message: "已停止生成。", retryable: false });
      } else {
        setError({ message: "停止生成失败，请稍后重试。", retryable: true });
      }
    } catch (caught) {
      setError(toChatError(caught, "停止生成失败，请稍后重试。"));
    }
  }

  function lastQuery(): string | null {
    return lastQueryRef.current;
  }

  function abortInFlight(): void {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
  }

  return { send, stop, lastQuery, abortInFlight };
}