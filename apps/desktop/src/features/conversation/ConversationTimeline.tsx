import CitationList from "./CitationList";
import type { ChatMessage } from "./conversationModel";

interface ConversationTimelineProps {
  readonly messages: readonly ChatMessage[];
  readonly hasOlder: boolean;
  readonly onLoadMore: () => void;
  readonly threadRef: React.RefObject<HTMLOListElement | null>;
  readonly onThreadScroll: () => void;
  readonly busy: boolean;
  readonly editingId: number | null;
  readonly editValue: string;
  readonly onEditValueChange: (value: string) => void;
  readonly onSaveEdit: (id: number) => void;
  readonly onCancelEdit: () => void;
  readonly copiedId: number | null;
  readonly onCopy: (message: ChatMessage) => Promise<void>;
  readonly onEdit: (message: ChatMessage) => void;
  readonly onRegenerate: () => void;
  readonly autoPlay: boolean;
  readonly onAudioPlay: () => void;
  readonly onAudioPause: () => void;
  readonly onAudioEnded: () => void;
  readonly onAudioError: () => void;
  readonly readOnly: boolean;
  readonly onStopPlayback: () => void;
  readonly onReplayLatest: (message: ChatMessage) => void;
  readonly latestAudioMessageId: number | null;
  readonly showScrollToBottom: boolean;
  readonly onScrollToBottom: () => void;
}

/**
 * The scrollable message list plus per-message actions (copy / edit /
 * regenerate) and the "load older" / "back to latest" affordances. Purely
 * presentational: all state and handlers come from the controller.
 */
export default function ConversationTimeline({
  messages,
  hasOlder,
  onLoadMore,
  threadRef,
  onThreadScroll,
  busy,
  editingId,
  editValue,
  onEditValueChange,
  onSaveEdit,
  onCancelEdit,
  copiedId,
  onCopy,
  onEdit,
  onRegenerate,
  autoPlay,
  readOnly,
  onAudioPlay,
  onAudioPause,
  onAudioEnded,
  onAudioError,
  onStopPlayback,
  onReplayLatest,
  latestAudioMessageId,
  showScrollToBottom,
  onScrollToBottom,
}: ConversationTimelineProps) {
  return (
    <>
      <ol
        ref={threadRef}
        className="conversation-thread"
        aria-label="对话记录"
        onScroll={onThreadScroll}
      >
        {hasOlder ? (
          <li className="conversation-load-more">
            <button type="button" onClick={onLoadMore}>
              加载更早的消息
            </button>
          </li>
        ) : null}
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
            {message.role === "assistant" && message.regenerated ? (
              <span className="conversation-regenerated">已重新生成</span>
            ) : null}
            {message.role === "user" && editingId === message.id ? (
              <label>
                编辑问题
                <textarea
                  value={editValue}
                  onChange={(event) => onEditValueChange(event.target.value)}
                  rows={2}
                />
                <button type="button" onClick={() => onSaveEdit(message.id)}>
                  保存并重新发送
                </button>
                <button type="button" onClick={onCancelEdit}>
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
                noBasis={message.noBasis}
              />
            ) : null}
            {message.role === "assistant" && message.audioBase64 && !readOnly ? (
              <audio
                className="conversation-message-audio"
                data-message-id={message.id}
                controls
                autoPlay={autoPlay}
                src={`data:audio/wav;base64,${message.audioBase64}`}
                onPlay={onAudioPlay}
                onPause={onAudioPause}
                onEnded={onAudioEnded}
                onError={onAudioError}
              />
            ) : null}
            <div className="conversation-message-actions">
              <button
                type="button"
                onClick={() => void onCopy(message)}
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
                  onClick={() => onEdit(message)}
                  disabled={busy}
                >
                  编辑
                </button>
              ) : null}
              {message.role === "assistant" &&
              messages[messages.length - 1]?.id === message.id ? (
                <button
                  type="button"
                  onClick={onRegenerate}
                  disabled={busy}
                >
                  重新生成
                </button>
              ) : null}
              {message.role === "assistant" &&
              latestAudioMessageId === message.id ? (
                <>
                  <button type="button" onClick={onStopPlayback}>
                    停止朗读
                  </button>
                  <button
                    type="button"
                    onClick={() => onReplayLatest(message)}
                  >
                    重新朗读
                  </button>
                </>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
      {showScrollToBottom && messages.length > 0 ? (
        <button
          type="button"
          className="conversation-scroll-bottom"
          onClick={onScrollToBottom}
        >
          回到最新消息
        </button>
      ) : null}
    </>
  );
}