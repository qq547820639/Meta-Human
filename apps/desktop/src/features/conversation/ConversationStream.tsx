import { useRef, useState } from "react";

import {
  Citation,
  stopGenerating,
  streamConversationReply,
} from "./conversationClient";
import {
  ConversationSummary,
  getConversation,
} from "./conversationManagementClient";
import ConversationManagement from "./ConversationManagement";
import CitationList from "./CitationList";

type StreamPhase =
  | "idle"
  | "understanding"
  | "retrieving"
  | "found_sources"
  | "generating"
  | "voice"
  | "playing";

interface ChatMessage {
  readonly id: number;
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly citations?: readonly Citation[];
  readonly grounded?: boolean;
}

interface ConversationStreamProps {
  readonly portraitPath?: string | null;
}

const phaseLabels: Record<StreamPhase, string> = {
  idle: "",
  understanding: "正在理解问题",
  retrieving: "正在检索知识",
  found_sources: "找到相关来源",
  generating: "正在生成回答",
  voice: "正在生成声音",
  playing: "正在启动数字人播放",
};

/**
 * The main conversation view. It restores the current conversation, streams
 * the answer token-by-token and shows phased feedback, plus a management
 * sidebar for creating/switching between conversations.
 */
export default function ConversationStream({
  portraitPath,
}: ConversationStreamProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<StreamPhase>("idle");
  const [sourcesCount, setSourcesCount] = useState(0);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const nextId = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const lastQueryRef = useRef<string | null>(null);

  function appendMessage(message: Omit<ChatMessage, "id">) {
    nextId.current += 1;
    setMessages((current) => [
      ...current,
      { ...message, id: nextId.current },
    ]);
  }

  function handleSelectConversation(conversation: ConversationSummary) {
    setConversationId(conversation.id);
    setError(null);
    void getConversation(conversation.id)
      .then((detail) => {
        nextId.current = 0;
        setMessages(
          detail.messages.map((message, index) => ({
            id: -(index + 1),
            role: message.role,
            text: message.content,
            citations: (message.citations ?? []).map((citation) => ({
              id: citation,
              title: citation,
              type: "source",
            })),
            grounded: message.grounded,
          })),
        );
      })
      .catch(() => setError("无法读取对话内容。"));
  }

  async function handleSend(
    overrideQuery?: string,
    appendUser = true,
    regenerate = false,
  ) {
    const trimmed = (overrideQuery ?? query).trim();
    if (!trimmed) {
      return;
    }
    setError(null);
    lastQueryRef.current = trimmed;
    if (appendUser) {
      appendMessage({ role: "user", text: trimmed });
    }
    setQuery("");
    setStreaming(true);
    setPhase("understanding");
    setSourcesCount(0);

    const controller = new AbortController();
    abortRef.current = controller;

    let assistantId: number | null = null;
    let building = "";
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
          onStage: (stage) => setPhase(stage),
          onFoundSources: (count) => {
            setSourcesCount(count);
            setPhase("found_sources");
          },
          onToken: (text) => {
            building += text;
            if (!generating) {
              generating = true;
              setPhase("generating");
            }
            if (assistantId === null) {
              assistantId = nextId.current + 1;
              nextId.current += 1;
              setMessages((current) => [
                ...current,
                { id: assistantId!, role: "assistant", text: building },
              ]);
            } else {
              setMessages((current) =>
                current.map((message) =>
                  message.id === assistantId
                    ? { ...message, text: building }
                    : message,
                ),
              );
            }
          },
          onCitations: (nextCitations, nextGrounded) => {
            citations = nextCitations;
            grounded = nextGrounded;
          },
          onDone: (text) => {
            setPhase("voice");
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantId
                  ? { ...message, text, citations, grounded }
                  : message,
              ),
            );
            window.setTimeout(() => setPhase("playing"), 500);
            window.setTimeout(() => setPhase("idle"), 1500);
          },
          onError: (message, _retryable) => {
            setError(message);
            setPhase("idle");
            setQuery(trimmed);
          },
        },
      });
    } catch (caught) {
      if (caught instanceof Error && caught.name === "AbortError") {
        setError("已停止生成。");
        setQuery(trimmed);
      } else {
        setError("对话服务暂时无法回复。");
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
    abortRef.current?.abort();
    try {
      await stopGenerating();
    } catch {
      // The local abort already stopped the stream; nothing else to do.
    }
  }

  const statusLabel =
    phase === "found_sources" && sourcesCount > 0
      ? `找到 ${sourcesCount} 个相关来源`
      : phaseLabels[phase];

  return (
    <section className="conversation-stream" aria-label="对话">
      <ConversationManagement
        selectedId={conversationId ?? undefined}
        onSelect={handleSelectConversation}
        onCreated={(conversation) => setConversationId(conversation.id)}
        onCleared={() => setMessages([])}
        onDeleted={(id) => {
          if (id === conversationId) {
            setConversationId(null);
            setMessages([]);
          }
        }}
      />
      <div className="conversation-stream-main">
        {portraitPath ? (
          <img
            className="conversation-portrait"
            src={portraitPath}
            alt="你的数字人人像"
          />
        ) : null}
        <p className="studio-status-title">与你的数字人对话</p>
        <ol className="conversation-thread" aria-label="对话记录">
          {messages.map((message) => (
            <li
              key={message.id}
              className={`conversation-message conversation-${message.role}`}
            >
              <p>{message.text}</p>
              {message.role === "assistant" && message.citations ? (
                <CitationList
                  citations={message.citations}
                  grounded={message.grounded ?? false}
                />
              ) : null}
            </li>
          ))}
        </ol>
        {streaming ? (
          <p className="conversation-status" role="status">
            {statusLabel}
          </p>
        ) : null}
        {streaming ? (
          <button type="button" onClick={() => void handleStop()}>
            停止生成
          </button>
        ) : null}
        {error ? <p role="alert">{error}</p> : null}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void handleSend();
          }}
        >
          <label>
            问题
            <textarea
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              disabled={streaming}
              rows={2}
            />
          </label>
          <button type="submit" disabled={streaming}>
            发送
          </button>
        </form>
        {lastQueryRef.current && !streaming ? (
          <button
            type="button"
            onClick={() =>
              void handleSend(lastQueryRef.current ?? undefined, false, true)
            }
          >
            重新生成
          </button>
        ) : null}
      </div>
    </section>
  );
}