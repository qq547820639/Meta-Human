import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";

import {
  ConversationReply,
  clearConversationHistory,
  listConversationHistory,
  postConversationReply,
  transcribeRecording,
} from "./conversationClient";
import {
  deleteMediaFile,
  startRecording,
  stopRecording,
} from "../creation/captureClient";

interface ChatMessage {
  readonly id: number;
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly createdAt?: string;
  readonly citations?: readonly string[];
  readonly citationUrls?: readonly (string | null)[];
  readonly grounded?: boolean;
  readonly audioBase64?: string | null;
}

interface ConversationProps {
  readonly portraitPath?: string | null;
  readonly streamUrl?: string | null;
}

const suggestedQuestions = [
  "我的数字人是怎么创建的？",
  "你能从我的知识里找到什么？",
  "今天可以帮我做什么？",
];

export default function Conversation({
  portraitPath,
  streamUrl,
}: ConversationProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [recordingVoice, setRecordingVoice] = useState(false);
  const [streamFailed, setStreamFailed] = useState(false);
  const nextId = useRef(0);
  const threadRef = useRef<HTMLOListElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const lastQueryRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const node = threadRef.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [messages, loading]);

  useEffect(() => {
    if (!loading) {
      inputRef.current?.focus();
    }
  }, [loading]);

  useEffect(() => {
    setStreamFailed(false);
  }, [streamUrl]);

  useEffect(() => {
    let active = true;
    listConversationHistory()
      .then((history) => {
        if (!active || nextId.current !== 0) return;
        setMessages(
          history.messages.map((message, index) => ({
            id: -(index + 1),
            role: message.role,
            text: message.content,
            createdAt: message.createdAt ?? undefined,
            citations: message.citations,
            citationUrls: message.citationUrls,
            grounded: message.grounded,
          })),
        );
      })
      .catch(() => {
        if (active) setError("无法读取对话历史。");
      });
    return () => {
      active = false;
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

  async function handleSend(
    overrideQuery?: string,
    appendUser = true,
    regenerate = false,
  ) {
    const trimmed = (overrideQuery ?? query).trim();
    if (!trimmed) {
      setError("请先输入一个问题。");
      return;
    }
    setError(null);
    lastQueryRef.current = trimmed;
    if (appendUser) {
      appendMessage({ role: "user", text: trimmed });
    }
    setQuery("");
    setLoading(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const reply: ConversationReply = await postConversationReply(
        trimmed,
        controller.signal,
        regenerate,
      );
      appendMessage({
        role: "assistant",
        text: reply.text,
        citations: reply.citations,
        grounded: reply.grounded,
        audioBase64: reply.audioBase64,
        citationUrls: reply.citationUrls,
      });
    } catch (caught) {
      if (caught instanceof Error && caught.name === "AbortError") {
        setError("已停止生成。");
        setQuery(trimmed);
        return;
      }
      setError(
        caught instanceof Error
          ? caught.message
          : "对话服务暂时无法回复。",
      );
      setQuery(trimmed);
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
      setLoading(false);
    }
  }

  function handleStopGeneration() {
    abortRef.current?.abort();
  }

  function handleSuggestedQuestion(question: string) {
    setQuery(question);
    inputRef.current?.focus();
  }

  async function handleVoiceInput() {
    setError(null);
    try {
      await startRecording();
      setRecordingVoice(true);
    } catch {
      setError("无法开始录音，请检查麦克风后重试。");
    }
  }

  async function handleStopVoiceInput() {
    setError(null);
    try {
      const audioPath = await stopRecording();
      const text = await transcribeRecording(audioPath);
      await deleteMediaFile(audioPath);
      if (!text.trim()) {
        setError("没有听清，请再试一次。");
        return;
      }
      setQuery(text);
      inputRef.current?.focus();
    } catch {
      setError("语音识别失败，请检查麦克风后重试。");
    } finally {
      setRecordingVoice(false);
    }
  }

  function handleClear() {
    if (!confirmingClear) {
      setConfirmingClear(true);
      window.setTimeout(() => setConfirmingClear(false), 3000);
      return;
    }
    setMessages([]);
    setQuery("");
    setError(null);
    setConfirmingClear(false);
    void clearConversationHistory().catch(() => {
      setError("无法清空对话历史。");
    });
  }

  async function handleCopy(message: ChatMessage) {
    try {
      await navigator.clipboard.writeText(message.text);
      setCopiedId(message.id);
      window.setTimeout(() => {
        setCopiedId((current) => (current === message.id ? null : current));
      }, 1500);
    } catch {
      setError("无法复制回答。");
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
      setError("无法复制对话。");
    }
  }

  function handleRegenerate() {
    const lastQuery = lastQueryRef.current;
    if (!lastQuery || loading) {
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
    void handleSend(lastQuery, false, true);
  }

  return (
    <section className="studio-status conversation-panel" aria-label="对话">
      <div>
        <p className="studio-status-title">第一次回应</p>
        {portraitPath ? (
          <div
            className={`conversation-avatar${
              speaking ? " conversation-avatar-speaking" : ""
            }`}
          >
            {streamUrl && !streamFailed ? (
              <video
                className="conversation-avatar-stream"
                src={streamUrl}
                autoPlay
                muted
                playsInline
                onPlay={() => setSpeaking(true)}
                onPause={() => setSpeaking(false)}
                onEnded={() => setSpeaking(false)}
                onError={() => setStreamFailed(true)}
              />
            ) : (
              <img
                src={convertFileSrc(portraitPath)}
                alt="你的数字人人像"
              />
            )}
          </div>
        ) : null}
        {streamFailed ? (
          <p className="conversation-stream-fallback" role="status">
            实时形象暂时不可用，已切换为人像。
          </p>
        ) : null}
        {speaking ? (
          <p className="conversation-speaking" role="status">
            正在说话…
          </p>
        ) : null}
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
        ) : null}
        {messages.length > 0 ? (
          <ol
            ref={threadRef}
            className="conversation-thread"
            aria-label="对话记录"
          >
            {messages.map((message) => (
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
                <p>{message.text}</p>
                {message.role === "assistant" &&
                message.citations &&
                message.citations.length > 0 ? (
                  <p className="conversation-citation">
                    {message.grounded ? "来源：" : null}
                    {message.citations.map((citation, index) => {
                      const url = message.citationUrls?.[index];
                      const separator =
                        index === 0 ? null : <span aria-hidden="true">、</span>;
                      return (
                        <span key={`${citation}-${index}`}>
                          {separator}
                          {url ? (
                            <a
                              href={url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {citation}
                            </a>
                          ) : (
                            citation
                          )}
                        </span>
                      );
                    })}
                  </p>
                ) : message.role === "assistant" &&
                  message.grounded === false ? (
                  <p className="conversation-citation">
                    这条回答没有引用本地知识。
                  </p>
                ) : null}
                {message.role === "assistant" && message.audioBase64 ? (
                  <audio
                    controls
                    src={`data:audio/wav;base64,${message.audioBase64}`}
                    onPlay={() => setSpeaking(true)}
                    onPause={() => setSpeaking(false)}
                    onEnded={() => setSpeaking(false)}
                  />
                ) : null}
                {message.role === "assistant" ? (
                  <button
                    type="button"
                    onClick={() => void handleCopy(message)}
                  >
                    {copiedId === message.id ? "已复制" : "复制"}
                  </button>
                ) : null}
                {message.role === "assistant" &&
                messages[messages.length - 1]?.id === message.id ? (
                  <button
                    type="button"
                    onClick={handleRegenerate}
                    disabled={loading}
                  >
                    重新生成
                  </button>
                ) : null}
              </li>
            ))}
          </ol>
        ) : null}
        {loading ? (
          <>
            <p className="conversation-status" role="status">
              正在思考…
            </p>
            <button type="button" onClick={handleStopGeneration}>
              停止生成
            </button>
          </>
        ) : null}
        {error ? (
          <p role="alert">{error}</p>
        ) : null}
        {recordingVoice ? (
          <p role="status">正在录音…</p>
        ) : null}
        {error && lastQueryRef.current ? (
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
            disabled={loading}
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
              disabled={loading}
              rows={2}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void handleSend();
                }
              }}
            />
          </label>
          <button type="submit" disabled={loading}>
            发送
          </button>
          {messages.length > 0 ? (
            <>
              <button type="button" onClick={() => void handleCopyAll()}>
                {copiedAll ? "已复制全部" : "复制全部"}
              </button>
              <button type="button" onClick={handleClear}>
                {confirmingClear ? "确认清空？" : "清空对话"}
              </button>
            </>
          ) : null}
        </form>
      </div>
    </section>
  );
}
