import { useEffect, useRef, useState } from "react";

import { ApiError, copyRequestId } from "../../api/client";
import { clearConversationMessages } from "./conversationManagementClient";
import type { ConversationSummary } from "./conversationManagementClient";
import {
  currentStatusLabel,
  isSpeaking,
  isUiActive,
  type ConversationUiState,
} from "./conversationStateMachine";
import {
  buildJsonExport,
  buildMarkdownExport,
  exportFileName,
  saveTextFile,
  type ConversationExportData,
  type ExportFormat,
} from "./conversationExport";
import {
  emptyConversationMetrics,
  mergeMetrics,
  type ConversationMetrics,
} from "./conversationMetrics";
import {
  INITIAL_VISIBLE_COUNT,
  SCROLL_BOTTOM_THRESHOLD,
  suggestedQuestions,
  toChatError,
  type ChatError,
  type ChatMessage,
} from "./conversationModel";
import { useAvatarSession } from "./useAvatarSession";
import { useConversationRestore } from "./useConversationRestore";
import { useConversationStateMachine } from "./useConversationStateMachine";
import { useStreamingReply } from "./useStreamingReply";
import { useTtsPlayback } from "./useTtsPlayback";
import { useVoiceRecording } from "./useVoiceRecording";

export interface ConversationControllerProps {
  readonly portraitPath?: string | null;
  readonly streamUrl?: string | null;
  readonly initialConversationId?: string | null;
  readonly humanId?: string | null;
  readonly humanName?: string | null;
  /** Display name of the model used for replies, included in exports. */
  readonly modelName?: string | null;
}

/**
 * Orchestrates the whole conversation workspace. It owns the message list,
 * conversation selection, media elements and clipboard/editing state, and
 * composes the independent sub-hooks:
 *
 *   - useConversationStateMachine : parallel UI state machine
 *   - useStreamingReply           : send / stop / token buffer
 *   - useConversationRestore      : restore / switch / paginate messages
 *   - useVoiceRecording           : voice input
 *   - useTtsPlayback              : audio element events -> tts dimension
 *   - useAvatarSession            : video element events -> avatar dimension
 *
 * The component (`ConversationWorkspace`) is a thin renderer over this hook.
 */
export function useConversationController({
  streamUrl,
  initialConversationId,
  humanId,
  humanName,
  modelName,
}: ConversationControllerProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<ChatError | null>(null);
  const [sourcesCount, setSourcesCount] = useState(0);
  const [conversationId, setConversationId] = useState<string | null>(
    initialConversationId ?? null,
  );
  const [conversationName, setConversationName] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);
  const [copiedRequestId, setCopiedRequestId] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [autoPlay, setAutoPlay] = useState(true);
  const [readOnly, setReadOnly] = useState(false);
  const [metrics, setMetrics] = useState<ConversationMetrics>(
    emptyConversationMetrics,
  );
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_COUNT);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);

  const threadRef = useRef<HTMLOListElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const atBottomRef = useRef(true);
  const needsTitleRef = useRef(false);
  const humanIdRef = useRef<string | null | undefined>(humanId);

  const { ui, dispatch } = useConversationStateMachine();

  const getConversationId = () => conversationId;
  const setConversationIdSink = (id: string | null) => setConversationId(id);
  const onMetrics = (partial: Partial<ConversationMetrics>) =>
    setMetrics((current) => mergeMetrics(current, partial));

  function resetThreadState() {
    setVisibleCount(INITIAL_VISIBLE_COUNT);
    atBottomRef.current = true;
    setShowScrollToBottom(false);
  }

  const { loadConversation, loadMoreMessages, clearPagination } =
    useConversationRestore({
      dispatch,
      setMessages,
      setHasOlder,
      setVisibleCount,
      setError,
      setConversationId: setConversationIdSink,
      setConversationName,
      getConversationId,
      resetThreadState,
    });

  const { send, stop, lastQuery, abortInFlight } = useStreamingReply({
    dispatch,
    setMessages,
    setError,
    setQuery,
    setStreaming,
    setSourcesCount,
    getConversationId,
    needsTitleRef,
    onMetrics,
  });

  const { recordingVoice, startVoiceInput, stopVoiceInput } =
    useVoiceRecording({
      dispatch,
      setError,
      setQuery,
      focusInput: () => inputRef.current?.focus(),
    });

  const {
    ttsFailed,
    onAudioPlay,
    onAudioPause,
    onAudioEnded,
    onAudioError,
    stopPlayback,
    replayLatest,
  } = useTtsPlayback({ ui, dispatch, onMetrics });

  const {
    avatarFailed,
    onVideoLoadedData,
    onVideoPlay,
    onVideoPause,
    onVideoEnded,
    onVideoError,
  } = useAvatarSession({ ui, dispatch, streamUrl, onMetrics });

  // When the selected digital human changes, safely stop the previous human's
  // avatar stream, audio playback and unfinished generation before the new
  // human is initialized, so stale audio / streams never cross the boundary.
  useEffect(() => {
    if (humanIdRef.current === humanId) {
      return;
    }
    humanIdRef.current = humanId;
    abortInFlight();
    document
      .querySelectorAll<HTMLAudioElement>("audio.conversation-message-audio")
      .forEach((node) => {
        node.pause();
        node.removeAttribute("src");
      });
    const video = document.querySelector<HTMLVideoElement>(
      ".conversation-avatar-stream",
    );
    if (video) {
      video.pause();
      video.removeAttribute("src");
      video.load();
    }
    dispatch({ type: "RESET" });
    setError(null);
    // `abortInFlight` is recreated each render; its behavior is stable (it only
    // reads refs and stable setters), so it must not be a dependency here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [humanId, dispatch]);

  useEffect(() => {
    const node = threadRef.current;
    if (node && atBottomRef.current) {
      node.scrollTop = node.scrollHeight;
    }
  }, [messages, streaming, ui]);

  useEffect(() => {
    if (!streaming) {
      inputRef.current?.focus();
    }
  }, [streaming]);

  useEffect(() => {
    if (readOnly) {
      stopPlayback();
    }
    // stopPlayback is recreated each render but only reads the DOM and stable
    // dispatch, so it must not be a dependency here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly]);

  function handleSend() {
    void send(query);
  }

  function handleClear() {
    setConfirmingClear(true);
  }

  async function performClear() {
    setConfirmingClear(false);
    if (conversationId) {
      try {
        await clearConversationMessages(conversationId);
      } catch (caught) {
        // Only clear the UI after the backend confirms the clear succeeded, so
        // a failed request never silently drops local messages. On failure we
        // keep the pre-clear snapshot and surface the error.
        setError(
          caught instanceof ApiError
            ? {
                message: caught.message,
                retryable: caught.retryable,
                requestId: caught.requestId || undefined,
                recommendedAction: caught.recommendedAction,
              }
            : { message: "无法清空对话。", retryable: true },
        );
        return;
      }
    }
    setMessages([]);
    setQuery("");
    setError(null);
    clearPagination();
    setHasOlder(false);
  }

  async function handleCopy(message: ChatMessage) {
    try {
      await navigator.clipboard.writeText(message.text);
      setCopiedId(message.id);
      window.setTimeout(() => {
        setCopiedId((current) => (current === message.id ? null : current));
      }, 1500);
    } catch {
      setError({ message: "无法复制。", retryable: false });
    }
  }

  async function handleCopyAll() {
    const text = messages
      .map((message) => {
        const speaker = message.role === "user" ? "我" : "数字人";
        return `${speaker}: ${message.text}`;
      })
      .join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopiedAll(true);
      window.setTimeout(() => setCopiedAll(false), 1500);
    } catch {
      setError({ message: "无法复制对话。", retryable: false });
    }
  }

  async function handleCopyRequestId() {
    if (!error?.requestId) {
      return;
    }
    const copied = await copyRequestId(
      new ApiError(
        {
          code: "request_failed",
          message: error.message,
          retryable: error.retryable,
          request_id: error.requestId,
          recommended_action: error.recommendedAction ?? null,
          technical_message: null,
          details: null,
          provider: null,
          provider_status: null,
          timestamp: null,
        },
        0,
      ),
    );
    if (copied) {
      setCopiedRequestId(true);
      window.setTimeout(() => setCopiedRequestId(false), 1500);
    }
  }

  function handleRegenerate() {
    const lastGenerated = lastQuery();
    if (!lastGenerated || streaming) {
      return;
    }
    setMessages((current) => {
      const lastUserIndex = [...current]
        .reverse()
        .findIndex((message) => message.role === "user");
      if (lastUserIndex === -1) {
        return current;
      }
      const keepThrough = current.length - 1 - lastUserIndex;
      return current.slice(0, keepThrough + 1);
    });
    void send(lastGenerated, false, true, true);
  }

  function handleEdit(message: ChatMessage) {
    setEditingId(message.id);
    setEditValue(message.text);
  }

  function handleCancelEdit() {
    setEditingId(null);
    setEditValue("");
  }

  function handleSaveEdit(id: number) {
    const text = editValue.trim();
    if (!text) {
      return;
    }
    setMessages((current) => {
      const index = current.findIndex((message) => message.id === id);
      if (index === -1) {
        return current;
      }
      return current
        .slice(0, index + 1)
        .map((message, i) =>
          i === index ? { ...message, text } : message,
        );
    });
    setEditingId(null);
    setEditValue("");
    void send(text, false, true, true);
  }

  async function resolveAppVersion(): Promise<string> {
    try {
      const { getVersion } = await import("@tauri-apps/api/app");
      return await getVersion();
    } catch {
      // Version lookup is best-effort; the export should still proceed with an
      // empty version when the API is unavailable (e.g. in a browser test).
      return "";
    }
  }

  async function handleExport(format: ExportFormat) {
    const exportMessages: ConversationExportData["messages"] = messages.map(
      (message) => ({
        role: message.role,
        text: message.text,
        createdAt: message.createdAt ?? null,
        citations: message.citations?.map((citation) => citation.title) ?? [],
        grounded: message.grounded,
      }),
    );
    if (exportMessages.length === 0) {
      setError({ message: "该会话暂无内容可导出。", retryable: false });
      return;
    }
    const data: ConversationExportData = {
      conversationName: conversationName || "未命名对话",
      exportedAt: new Date().toISOString(),
      digitalHuman: humanName ?? "",
      model: modelName ?? "",
      appVersion: await resolveAppVersion(),
      messages: exportMessages,
    };
    const content =
      format === "markdown"
        ? buildMarkdownExport(data)
        : buildJsonExport(data);
    try {
      const saved = await saveTextFile(
        exportFileName(data.conversationName, format),
        content,
      );
      if (saved === null) {
        // User cancelled the native save dialog; that is not an error.
        return;
      }
    } catch (caught) {
      setError(
        toChatError(caught, "导出失败，请重试。"),
      );
    }
  }

  function handleSuggestedQuestion(question: string) {
    setQuery(question);
    inputRef.current?.focus();
  }

  function handleRetry() {
    const last = lastQuery();
    if (last) {
      void send(last);
    }
  }

  function handleThreadScroll() {
    const node = threadRef.current;
    if (!node) {
      return;
    }
    const nearBottom =
      node.scrollHeight - node.scrollTop - node.clientHeight <
      SCROLL_BOTTOM_THRESHOLD;
    atBottomRef.current = nearBottom;
    setShowScrollToBottom((prev) =>
      prev === !nearBottom ? prev : !nearBottom,
    );
  }

  function scrollToBottom() {
    atBottomRef.current = true;
    setShowScrollToBottom(false);
    const node = threadRef.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }

  function handleCreated(conversation: ConversationSummary) {
    setConversationId(conversation.id);
    setConversationName(conversation.name);
    setMessages([]);
    setQuery("");
    setError(null);
    dispatch({ type: "RESET" });
    resetThreadState();
    clearPagination();
    setHasOlder(false);
    needsTitleRef.current = true;
  }

  function handleCleared(conversation: ConversationSummary) {
    setConversationName(conversation.name);
    setMessages([]);
    clearPagination();
    setHasOlder(false);
  }

  function handleDeleted(id: string) {
    if (id === conversationId) {
      setConversationId(null);
      setConversationName("");
      setMessages([]);
    }
  }

  const visibleMessages = messages.slice(-visibleCount);
  const statusLabel = currentStatusLabel(ui, sourcesCount);
  const isActive = streaming || isUiActive(ui);
  const busy = streaming;
  const speaking = isSpeaking(ui);
  const latestAudioMessage = [...messages]
    .reverse()
    .find((message) => message.role === "assistant" && !!message.audioBase64);

  return {
    ui,
    messages,
    visibleMessages,
    query,
    setQuery,
    error,
    conversationId,
    conversationName,
    streaming,
    busy,
    speaking,
    isActive,
    statusLabel,
    sourcesCount,
    ttsFailed,
    avatarFailed,
    recordingVoice,
    humanName,
    autoPlay,
    setAutoPlay,
    readOnly,
    setReadOnly,
    metrics,
    stopPlayback,
    replayLatest,
    latestAudioMessage,
    copiedId,
    copiedAll,
    copiedRequestId,
    confirmingClear,
    setConfirmingClear,
    editingId,
    editValue,
    setEditValue,
    hasOlder,
    showScrollToBottom,
    suggestedQuestions,
    threadRef,
    inputRef,
    handleSend,
    handleStop: stop,
    handleVoiceInput: startVoiceInput,
    handleStopVoiceInput: stopVoiceInput,
    handleClear,
    performClear,
    handleCopy,
    handleCopyAll,
    handleCopyRequestId,
    handleRegenerate,
    handleEdit,
    handleCancelEdit,
    handleSaveEdit,
    handleExport,
    handleSuggestedQuestion,
    handleRetry,
    handleThreadScroll,
    scrollToBottom,
    loadMoreMessages,
    loadConversation,
    handleCreated,
    handleCleared,
    handleDeleted,
    onAudioPlay,
    onAudioPause,
    onAudioEnded,
    onAudioError,
    onVideoLoadedData,
    onVideoPlay,
    onVideoPause,
    onVideoEnded,
    onVideoError,
  };
}

export type ConversationController = ReturnType<typeof useConversationController>;
export type { ConversationUiState };