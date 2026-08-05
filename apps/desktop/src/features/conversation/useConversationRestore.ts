import { useEffect, useRef } from "react";

import { listConversationMessages } from "./conversationManagementClient";
import type {
  ConversationMessage,
  ConversationSummary,
} from "./conversationManagementClient";
import type { ConversationUiAction } from "./conversationStateMachine";
import {
  PAGE_STEP,
  isAbortError,
  serverMessageToChat,
  toChatError,
  type ChatError,
  type ChatMessage,
} from "./conversationModel";

export interface UseConversationRestoreDeps {
  readonly dispatch: React.Dispatch<ConversationUiAction>;
  readonly setMessages: (updater: (m: ChatMessage[]) => ChatMessage[]) => void;
  readonly setHasOlder: (value: boolean) => void;
  readonly setVisibleCount: (value: number | ((c: number) => number)) => void;
  readonly setError: (error: ChatError | null) => void;
  readonly setConversationId: (id: string | null) => void;
  readonly setConversationName: (name: string) => void;
  readonly getConversationId: () => string | null;
  readonly resetThreadState: () => void;
}

export interface UseConversationRestoreResult {
  readonly loadConversation: (conversation: ConversationSummary) => void;
  readonly loadMoreMessages: () => void;
  /** Resets pagination cursors for a brand-new / cleared conversation. */
  readonly clearPagination: () => void;
}

/**
 * Restore / switch / paginate conversation messages. Reuses Task 2's message
 * pagination and always cancels the previous in-flight load so a stale
 * response can never overwrite the newly selected conversation.
 */
export function useConversationRestore({
  dispatch,
  setMessages,
  setHasOlder,
  setVisibleCount,
  setError,
  setConversationId,
  setConversationName,
  getConversationId,
  resetThreadState,
}: UseConversationRestoreDeps): UseConversationRestoreResult {
  // Server-loaded message ids are negative and unique per conversation so they
  // never collide with the positive ids assigned to newly streamed messages.
  const loadedIdRef = useRef(0);
  const nextCursorRef = useRef<string | null>(null);
  const loadControllerRef = useRef<AbortController | null>(null);

  function nextLoadedId() {
    loadedIdRef.current -= 1;
    return loadedIdRef.current;
  }

  function applyPage(page: {
    messages: readonly ConversationMessage[];
    nextCursor: string | null;
    hasMore: boolean;
  }) {
    loadedIdRef.current = 0;
    setMessages(() =>
      page.messages.map((message) => serverMessageToChat(message, nextLoadedId())),
    );
    nextCursorRef.current = page.nextCursor;
    setHasOlder(page.hasMore);
    setVisibleCount(page.messages.length);
  }

  // Restore the most recent conversation when entering the workspace.
  useEffect(() => {
    const initialConversationId = getConversationId();
    if (!initialConversationId) {
      return;
    }
    let active = true;
    const controller = new AbortController();
    listConversationMessages(initialConversationId, {
      limit: PAGE_STEP,
      signal: controller.signal,
    })
      .then((page) => {
        if (!active || controller.signal.aborted) {
          return;
        }
        applyPage(page);
      })
      .catch((caught) => {
        if (active && !isAbortError(caught)) {
          setError(toChatError(caught, "无法读取对话内容。"));
        }
      });
    return () => {
      active = false;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function loadConversation(conversation: ConversationSummary) {
    setConversationId(conversation.id);
    setConversationName(conversation.name);
    setError(null);
    dispatch({ type: "RESET" });
    resetThreadState();
    // Cancel any in-flight load from a previous conversation.
    loadControllerRef.current?.abort();
    const controller = new AbortController();
    loadControllerRef.current = controller;
    void listConversationMessages(conversation.id, {
      limit: PAGE_STEP,
      signal: controller.signal,
    })
      .then((page) => {
        if (controller.signal.aborted) {
          return;
        }
        applyPage(page);
      })
      .catch((caught) => {
        if (!isAbortError(caught)) {
          setError(toChatError(caught, "无法读取对话内容。"));
        }
      })
      .finally(() => {
        if (loadControllerRef.current === controller) {
          loadControllerRef.current = null;
        }
      });
  }

  function loadMoreMessages() {
    const conversationId = getConversationId();
    if (!conversationId || !nextCursorRef.current) {
      return;
    }
    loadControllerRef.current?.abort();
    const controller = new AbortController();
    loadControllerRef.current = controller;
    const cursor = nextCursorRef.current;
    void listConversationMessages(conversationId, {
      limit: PAGE_STEP,
      cursor,
      signal: controller.signal,
    })
      .then((page) => {
        if (controller.signal.aborted) {
          return;
        }
        const older = page.messages.map((message) =>
          serverMessageToChat(message, nextLoadedId()),
        );
        setMessages((current) => [...older, ...current]);
        nextCursorRef.current = page.nextCursor;
        setHasOlder(page.hasMore);
        setVisibleCount((count) => count + older.length);
      })
      .catch((caught) => {
        if (!isAbortError(caught)) {
          setError(toChatError(caught, "无法加载更早的消息。"));
        }
      })
      .finally(() => {
        if (loadControllerRef.current === controller) {
          loadControllerRef.current = null;
        }
      });
  }

  function clearPagination() {
    nextCursorRef.current = null;
    loadedIdRef.current = 0;
  }

  return { loadConversation, loadMoreMessages, clearPagination };
}

export type { ConversationMessage } from "./conversationManagementClient";