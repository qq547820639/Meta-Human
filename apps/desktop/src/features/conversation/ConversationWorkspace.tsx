import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";

import { ApiError, copyRequestId } from "../../api/client";
import {
  Citation,
  stopGenerating,
  streamConversationReply,
  transcribeRecording,
} from "./conversationClient";
import {
  ConversationMessage,
  ConversationSummary,
  clearConversationMessages,
  listConversationMessages,
  renameConversation,
} from "./conversationManagementClient";
import {
  deleteMediaFile,
  startRecording,
  stopRecording,
} from "../creation/captureClient";
import ConversationManagement from "./ConversationManagement";
import CitationList from "./CitationList";

/**
 * Phases of a single reply. The text phases are driven by the SSE stream; the
 * TTS / avatar phases are driven by real async events (TTS request result,
 * audio element events, avatar video element events) — never by fixed timers.
 */
export type ConversationPhase =
  | "idle"
  | "understanding"
  | "retrieving"
  | "found_sources"
  | "generating"
  | "tts_started"
  | "tts_completed"
  | "audio_playback_started"
  | "audio_playback_completed"
  | "avatar_stream_starting"
  | "avatar_stream_started"
  | "avatar_playback_completed";

interface ChatMessage {
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
interface ChatError {
  readonly message: string;
  readonly retryable: boolean;
  readonly requestId?: string;
  readonly recommendedAction?: string | null;
}

interface ConversationWorkspaceProps {
  readonly portraitPath?: string | null;
  readonly streamUrl?: string | null;
  readonly initialConversationId?: string | null;
  /** Id of the selected digital human; used to stop the previous human's
   * audio / stream when the selection changes. */
  readonly humanId?: string | null;
  /** Display name of the selected digital human. */
  readonly humanName?: string | null;
}

const suggestedQuestions = [
  "我的数字人是怎么创建的？",
  "你能从我的知识里找到什么？",
  "今天可以帮我做什么？",
];

const phaseLabels: Record<ConversationPhase, string> = {
  idle: "",
  understanding: "正在理解问题",
  retrieving: "正在检索知识",
  found_sources: "找到相关来源",
  generating: "正在生成回答",
  tts_started: "正在生成声音",
  tts_completed: "声音已准备好",
  audio_playback_started: "正在说话…",
  audio_playback_completed: "",
  avatar_stream_starting: "正在启动数字人",
  avatar_stream_started: "数字人已就绪",
  avatar_playback_completed: "",
};

/** How many messages are rendered at once; older ones load on demand. */
const INITIAL_VISIBLE_COUNT = 50;
const PAGE_STEP = 50;
const SCROLL_BOTTOM_THRESHOLD = 48;
const TITLE_MAX_LENGTH = 18;

function conversationMessageToCitations(
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

function serverMessageToChat(
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
function buildTitleFromQuestion(question: string): string {
  const cleaned = question.replace(/\s+/g, " ").trim();
  if (cleaned.length <= TITLE_MAX_LENGTH) {
    return cleaned;
  }
  return `${cleaned.slice(0, TITLE_MAX_LENGTH)}…`;
}

/**
 * The single conversation workspace. It is used for every entry point —
 * restore, create-then-chat, switching digital humans, switching conversations
 * and creating new conversations — so all paths share one component and state
 * model. It restores a conversation, streams replies token-by-token (with a
 * requestAnimationFrame-throttled buffer), plays TTS audio and the avatar
 * stream, and manages conversations in the sidebar.
 */
export default function ConversationWorkspace({
  portraitPath,
  streamUrl,
  initialConversationId,
  humanId,
  humanName,
}: ConversationWorkspaceProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<ChatError | null>(null);
  const [phase, setPhase] = useState<ConversationPhase>("idle");
  const [sourcesCount, setSourcesCount] = useState(0);
  const [conversationId, setConversationId] = useState<string | null>(
    initialConversationId ?? null,
  );
  const [streaming, setStreaming] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);
  const [copiedRequestId, setCopiedRequestId] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [recordingVoice, setRecordingVoice] = useState(false);
  const [ttsFailed, setTtsFailed] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [autoPlay, setAutoPlay] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_COUNT);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);
  const nextId = useRef(0);
  const threadRef = useRef<HTMLOListElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const lastQueryRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const generationIdRef = useRef<string | null>(null);
  const stoppedRef = useRef(false);
  const atBottomRef = useRef(true);
  const needsTitleRef = useRef(false);
  // Server-loaded message ids are negative and unique per conversation so they
  // never collide with the positive ids assigned to newly streamed messages.
  const loadedIdRef = useRef(0);
  const nextCursorRef = useRef<string | null>(null);
  const loadControllerRef = useRef<AbortController | null>(null);
  // Streaming throttle refs: tokens accumulate into `buildingRef` and are
  // flushed to React at most once per frame via requestAnimationFrame.
  const buildingRef = useRef("");
  const assistantIdRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  // Tracks the currently-initialized digital human so that switching the
  // selection safely stops the old human's stream / audio / pending work
  // before the new human is initialized.
  const humanIdRef = useRef<string | null>(humanId ?? null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // When the selected digital human changes, safely stop the previous human's
  // avatar stream, audio playback and any unfinished generation before the new
  // human is initialized. This prevents stale audio / streams crossing the
  // switch boundary.
  useEffect(() => {
    if (humanIdRef.current === humanId) {
      return;
    }
    humanIdRef.current = humanId ?? null;
    // Cancel any in-flight generation request for the previous human.
    abortRef.current?.abort();
    abortRef.current = null;
    // Pause any audio attached to the previous human's replies.
    document
      .querySelectorAll<HTMLAudioElement>("audio.conversation-message-audio")
      .forEach((node) => {
        node.pause();
        node.removeAttribute("src");
      });
    // Stop the previous human's avatar stream.
    const video = document.querySelector<HTMLVideoElement>(
      ".conversation-avatar-stream",
    );
    if (video) {
      video.pause();
      video.removeAttribute("src");
      video.load();
    }
    setStreaming(false);
    setSpeaking(false);
    setPhase("idle");
    setError(null);
    setTtsFailed(false);
    setAvatarFailed(false);
  }, [humanId]);

  useEffect(() => {
    const node = threadRef.current;
    if (node && atBottomRef.current) {
      node.scrollTop = node.scrollHeight;
    }
  }, [messages, streaming, phase]);

  useEffect(() => {
    if (!streaming) {
      inputRef.current?.focus();
    }
  }, [streaming]);

  useEffect(() => {
    setAvatarFailed(false);
  }, [streamUrl]);

  // Restore the most recent conversation when entering the workspace.
  useEffect(() => {
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
        loadedIdRef.current = 0;
        const restored = page.messages.map((message) =>
          serverMessageToChat(message, nextLoadedId()),
        );
        setMessages(restored);
        nextCursorRef.current = page.nextCursor;
        setHasOlder(page.hasMore);
        setVisibleCount(restored.length);
      })
      .catch((caught) => {
        if (active && !isAbortError(caught)) {
          setApiError(caught, "无法读取对话内容。");
        }
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [initialConversationId]);

  function nextLoadedId() {
    loadedIdRef.current -= 1;
    return loadedIdRef.current;
  }

  function isAbortError(caught: unknown): boolean {
    return caught instanceof Error && caught.name === "AbortError";
  }

  function setSimpleError(message: string) {
    setError({ message, retryable: false });
  }

  function setApiError(caught: unknown, fallback: string) {
    if (caught instanceof ApiError) {
      setError({
        message: caught.message,
        retryable: caught.retryable,
        requestId: caught.requestId || undefined,
        recommendedAction: caught.recommendedAction,
      });
    } else {
      setError({ message: fallback, retryable: true });
    }
  }

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

  function resetThreadState() {
    setVisibleCount(INITIAL_VISIBLE_COUNT);
    atBottomRef.current = true;
    setShowScrollToBottom(false);
  }

  function loadConversation(conversation: ConversationSummary) {
    setConversationId(conversation.id);
    setError(null);
    setTtsFailed(false);
    setAvatarFailed(false);
    setPhase("idle");
    resetThreadState();
    // Cancel any in-flight load from a previous conversation so a stale
    // response can never overwrite the newly selected conversation.
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
        loadedIdRef.current = 0;
        const loaded = page.messages.map((message) =>
          serverMessageToChat(message, nextLoadedId()),
        );
        setMessages(loaded);
        nextCursorRef.current = page.nextCursor;
        setHasOlder(page.hasMore);
        setVisibleCount(loaded.length);
      })
      .catch((caught) => {
        if (!isAbortError(caught)) {
          setApiError(caught, "无法读取对话内容。");
        }
      })
      .finally(() => {
        if (loadControllerRef.current === controller) {
          loadControllerRef.current = null;
        }
      });
  }

  // Streaming throttle: flush the accumulated token text to the message that
  // is currently being built. Called at most once per animation frame.
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

  async function handleSend(
    overrideQuery?: string,
    appendUser = true,
    regenerate = false,
    markRegenerated = false,
  ) {
    const trimmed = (overrideQuery ?? query).trim();
    if (!trimmed) {
      setSimpleError("请先输入一个问题。");
      return;
    }
    setError(null);
    setTtsFailed(false);
    setAvatarFailed(false);
    stoppedRef.current = false;
    lastQueryRef.current = trimmed;
    if (appendUser) {
      appendMessage({ role: "user", text: trimmed });
    }
    setQuery("");
    setStreaming(true);
    setPhase("understanding");
    setSourcesCount(0);

    // Best-effort title for a brand-new conversation (first user question).
    if (needsTitleRef.current && conversationId) {
      needsTitleRef.current = false;
      const title = buildTitleFromQuestion(trimmed);
      void renameConversation(conversationId, title).catch(() => {
        // Title generation is cosmetic; failing to persist it must not block
        // the conversation.
      });
    }

    const controller = new AbortController();
    abortRef.current = controller;
    generationIdRef.current = null;
    assistantIdRef.current = null;
    buildingRef.current = "";
    cancelTokenFlush();

    let citations: Citation[] = [];
    let grounded = false;
    let generating = false;

    try {
      await streamConversationReply({
        query: trimmed,
        conversationId,
        regenerate,
        signal: controller.signal,
        events: {
          onGenerationStarted: (generationId) => {
            generationIdRef.current = generationId;
          },
          onStage: (stage) => setPhase(stage),
          onFoundSources: (count) => {
            setSourcesCount(count);
            setPhase("found_sources");
          },
          onToken: (text) => {
            buildingRef.current += text;
            if (!generating) {
              generating = true;
              setPhase("generating");
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
          onCitations: (nextCitations, nextGrounded) => {
            citations = nextCitations;
            grounded = nextGrounded;
          },
          onDone: (text) => {
            cancelTokenFlush();
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantIdRef.current
                  ? {
                      ...message,
                      text,
                      citations,
                      grounded,
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
            setTtsFailed(false);
            setPhase("tts_completed");
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
          onError: (message, retryable) => {
            setError({ message, retryable });
            setPhase("idle");
            setQuery(trimmed);
          },
        },
      });
    } catch (caught) {
      if (caught instanceof Error && caught.name === "AbortError") {
        setError({ message: "已停止生成。", retryable: false });
        setQuery(trimmed);
      } else {
        setApiError(caught, "对话服务暂时无法回复。");
        setQuery(trimmed);
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
      setStreaming(false);
    }
  }

  async function handleStop() {
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
    try {
      const stopped = await stopGenerating(generationId);
      if (stopped) {
        setError({ message: "已停止生成。", retryable: false });
      } else {
        setError({ message: "停止生成失败，请稍后重试。", retryable: true });
      }
    } catch (caught) {
      setApiError(caught, "停止生成失败，请稍后重试。");
    }
  }

  async function handleVoiceInput() {
    setError(null);
    try {
      await startRecording();
      setRecordingVoice(true);
    } catch {
      setSimpleError("无法开始录音，请检查麦克风后重试。");
    }
  }

  async function handleStopVoiceInput() {
    setError(null);
    try {
      const audioPath = await stopRecording();
      const text = await transcribeRecording(audioPath);
      await deleteMediaFile(audioPath);
      if (!text.trim()) {
        setSimpleError("没有听清，请再试一次。");
        return;
      }
      setQuery(text);
      inputRef.current?.focus();
    } catch (caught) {
      setApiError(caught, "语音识别失败，请检查麦克风后重试。");
    } finally {
      setRecordingVoice(false);
    }
  }

  function handleClear() {
    // Open a real confirmation dialog instead of the "click again within 3s"
    // pattern, so an important destructive action needs an explicit decision.
    setConfirmingClear(true);
  }

  function performClear() {
    setConfirmingClear(false);
    setMessages([]);
    setQuery("");
    setError(null);
    nextCursorRef.current = null;
    setHasOlder(false);
    if (conversationId) {
      void clearConversationMessages(conversationId).catch((caught) => {
        setApiError(caught, "无法清空对话。");
      });
    }
  }

  async function handleCopy(message: ChatMessage) {
    try {
      await navigator.clipboard.writeText(message.text);
      setCopiedId(message.id);
      window.setTimeout(() => {
        setCopiedId((current) => (current === message.id ? null : current));
      }, 1500);
    } catch {
      setSimpleError("无法复制。");
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
      setSimpleError("无法复制对话。");
    }
  }

  async function handleCopyRequestId() {
    if (!error?.requestId) {
      return;
    }
    const copied = await copyRequestId(new ApiError(
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
    ));
    if (copied) {
      setCopiedRequestId(true);
      window.setTimeout(() => setCopiedRequestId(false), 1500);
    }
  }

  function handleRegenerate() {
    const lastQuery = lastQueryRef.current;
    if (!lastQuery || streaming) {
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
    void handleSend(lastQuery, false, true, true);
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
    void handleSend(text, false, true, true);
  }

  function handleExport() {
    const text = messages
      .map((message) => {
        const speaker = message.role === "user" ? "我" : "数字人";
        return `${speaker}: ${message.text}`;
      })
      .join("\n\n");
    if (!text) {
      return;
    }
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `conversation-${conversationId ?? "export"}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function handleSuggestedQuestion(question: string) {
    setQuery(question);
    inputRef.current?.focus();
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
    setShowScrollToBottom((prev) => (prev === !nearBottom ? prev : !nearBottom));
  }

  function scrollToBottom() {
    atBottomRef.current = true;
    setShowScrollToBottom(false);
    const node = threadRef.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }

  function loadMoreMessages() {
    if (!conversationId || !nextCursorRef.current || !hasOlder) {
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
          setApiError(caught, "无法加载更早的消息。");
        }
      })
      .finally(() => {
        if (loadControllerRef.current === controller) {
          loadControllerRef.current = null;
        }
      });
  }

  const visibleMessages = messages.slice(-visibleCount);
  const hasOlderMessages = hasOlder;

  const statusLabel =
    phase === "found_sources" && sourcesCount > 0
      ? `找到 ${sourcesCount} 个相关来源`
      : phaseLabels[phase];
  const isActive = streaming || phase !== "idle";
  const busy = streaming;

  return (
    <section className="conversation-workspace" aria-label="对话">
      <ConversationManagement
        selectedId={conversationId ?? undefined}
        onSelect={loadConversation}
        onCreated={(conversation) => {
          setConversationId(conversation.id);
          setMessages([]);
          setQuery("");
          setError(null);
          setPhase("idle");
          resetThreadState();
          nextCursorRef.current = null;
          setHasOlder(false);
          needsTitleRef.current = true;
        }}
        onCleared={() => {
          setMessages([]);
          nextCursorRef.current = null;
          setHasOlder(false);
        }}
        onDeleted={(id) => {
          if (id === conversationId) {
            setConversationId(null);
            setMessages([]);
          }
        }}
      />
      <div className="conversation-workspace-main">
        {portraitPath ? (
          <div
            className={`conversation-avatar${
              speaking ? " conversation-avatar-speaking" : ""
            }`}
          >
            {streamUrl && !avatarFailed ? (
              <video
                className="conversation-avatar-stream"
                src={streamUrl}
                autoPlay
                muted
                playsInline
                onLoadedData={() => setPhase("avatar_stream_started")}
                onPlay={() => setSpeaking(true)}
                onPause={() => setSpeaking(false)}
                onEnded={() => {
                  setSpeaking(false);
                  setPhase("avatar_playback_completed");
                }}
                onError={() => {
                  setAvatarFailed(true);
                  setPhase("idle");
                }}
              />
            ) : (
              <img
                src={convertFileSrc(portraitPath)}
                alt="你的数字人人像"
              />
            )}
          </div>
        ) : null}
        {avatarFailed ? (
          <p className="conversation-stream-fallback" role="status">
            数字人暂不可用，已切换为语音播放。
          </p>
        ) : null}
        {ttsFailed ? (
          <p className="conversation-tts-fallback" role="status">
            语音生成失败，已保留文字回答。
          </p>
        ) : null}
        <p className="studio-status-title">与你的数字人对话</p>
        {messages.length === 0 ? (
          <>
            <p className="conversation-empty">你的数字人会在这里回应你。</p>
            <div className="conversation-suggestions" aria-label="建议问题">
              {suggestedQuestions.map((question) => (
                <button
                  type="button"
                  key={question}
                  onClick={() => handleSuggestedQuestion(question)}
                >
                  {question}
                </button>
              ))}
            </div>
          </>
        ) : (
          <ol
            ref={threadRef}
            className="conversation-thread"
            aria-label="对话记录"
            onScroll={handleThreadScroll}
          >
            {hasOlderMessages ? (
              <li className="conversation-load-more">
                <button type="button" onClick={loadMoreMessages}>
                  加载更早的消息
                </button>
              </li>
            ) : null}
            {visibleMessages.map((message) => (
              <li
                key={message.id}
                className={`conversation-message conversation-${message.role}`}
              >
                {message.createdAt ? (
                  <time
                    className="conversation-time"
                    dateTime={message.createdAt}
                  >
                    {new Date(message.createdAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                ) : null}
                {message.role === "assistant" && message.regenerated ? (
                  <span className="conversation-regenerated">已重新生成</span>
                ) : null}
                {message.role === "user" && editingId === message.id ? (
                  <label>
                    编辑问题
                    <textarea
                      value={editValue}
                      onChange={(event) => setEditValue(event.target.value)}
                      rows={2}
                    />
                    <button
                      type="button"
                      onClick={() => handleSaveEdit(message.id)}
                    >
                      保存并重新发送
                    </button>
                    <button type="button" onClick={handleCancelEdit}>
                      取消
                    </button>
                  </label>
                ) : (
                  <p>{message.text}</p>
                )}
                {message.role === "assistant" && message.citations ? (
                  <CitationList
                    citations={message.citations}
                    grounded={message.grounded ?? false}
                  />
                ) : null}
                {message.role === "assistant" && message.audioBase64 ? (
                  <audio
                    className="conversation-message-audio"
                    controls
                    autoPlay={autoPlay}
                    src={`data:audio/wav;base64,${message.audioBase64}`}
                    onPlay={() => {
                      setSpeaking(true);
                      setPhase("audio_playback_started");
                    }}
                    onPause={() => setSpeaking(false)}
                    onEnded={() => {
                      setSpeaking(false);
                      setPhase("audio_playback_completed");
                    }}
                    onError={() => setTtsFailed(true)}
                  />
                ) : null}
                <div className="conversation-message-actions">
                  <button
                    type="button"
                    onClick={() => void handleCopy(message)}
                    aria-label={
                      message.role === "user"
                        ? copiedId === message.id
                          ? "已复制问题"
                          : "复制问题"
                        : copiedId === message.id
                          ? "已复制回答"
                          : "复制回答"
                    }
                  >
                    {copiedId === message.id ? "已复制" : "复制"}
                  </button>
                  {message.role === "user" ? (
                    <button
                      type="button"
                      onClick={() => handleEdit(message)}
                      disabled={busy}
                    >
                      编辑
                    </button>
                  ) : null}
                  {message.role === "assistant" &&
                  messages[messages.length - 1]?.id === message.id ? (
                    <button
                      type="button"
                      onClick={handleRegenerate}
                      disabled={busy}
                    >
                      重新生成
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        )}
        {showScrollToBottom && messages.length > 0 ? (
          <button
            type="button"
            className="conversation-scroll-bottom"
            onClick={scrollToBottom}
          >
            回到最新消息
          </button>
        ) : null}
        {isActive ? (
          <p className="conversation-status" role="status">
            {statusLabel}
          </p>
        ) : null}
        {streaming ? (
          <button type="button" onClick={() => void handleStop()}>
            停止生成
          </button>
        ) : null}
        {error ? (
          <div className="conversation-error" role="alert">
            <p>{error.message}</p>
            {error.retryable ? <p>此错误可重试。</p> : null}
            {error.recommendedAction ? (
              <p>{error.recommendedAction}</p>
            ) : null}
            {error.requestId ? (
              <button
                type="button"
                onClick={() => void handleCopyRequestId()}
              >
                {copiedRequestId ? "已复制请求编号" : "复制请求编号"}
              </button>
            ) : null}
          </div>
        ) : null}
        {recordingVoice ? (
          <p role="status">正在录音…</p>
        ) : null}
        {error && error.retryable && lastQueryRef.current ? (
          <button
            type="button"
            onClick={() => void handleSend(lastQueryRef.current ?? undefined)}
          >
            重试
          </button>
        ) : null}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void handleSend();
          }}
        >
          <button
            type="button"
            onClick={() =>
              recordingVoice
                ? void handleStopVoiceInput()
                : void handleVoiceInput()
            }
            disabled={busy}
          >
            {recordingVoice ? "停止录音" : "语音提问"}
          </button>
          <label>
            问题
            <textarea
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="继续问你的数字人"
              disabled={busy}
              rows={2}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void handleSend();
                }
              }}
            />
          </label>
          <button type="submit" disabled={busy}>
            发送
          </button>
          <label>
            <input
              type="checkbox"
              checked={autoPlay}
              onChange={(event) => setAutoPlay(event.target.checked)}
            />
            自动播放
          </label>
          {messages.length > 0 ? (
            <>
              <button type="button" onClick={() => void handleCopyAll()}>
                {copiedAll ? "已复制全部" : "复制全部"}
              </button>
              <button type="button" onClick={handleExport}>
                导出对话
              </button>
              <button type="button" onClick={handleClear}>
                清空对话
              </button>
            </>
          ) : null}
        </form>
      </div>
      {confirmingClear ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="clear-dialog-title"
          className="conversation-modal"
        >
          <h2 id="clear-dialog-title">清空对话</h2>
          <p>确认清空当前对话的全部消息？此操作不可撤销。</p>
          <button type="button" onClick={() => setConfirmingClear(false)}>
            取消
          </button>
          <button type="button" onClick={performClear}>
            清空
          </button>
        </div>
      ) : null}
    </section>
  );
}