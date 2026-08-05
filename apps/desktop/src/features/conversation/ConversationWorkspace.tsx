import { convertFileSrc } from "@tauri-apps/api/core";

import ConfirmDialog from "../../ui/ConfirmDialog";
import ConversationManagement from "./ConversationManagement";
import ConversationTimeline from "./ConversationTimeline";
import Composer from "./Composer";
import RecoveryBanner from "./RecoveryBanner";
import { formatMetricsLabel } from "./conversationMetrics";
import { suggestedQuestions } from "./conversationModel";
import { useConversationController } from "./useConversationController";

interface ConversationWorkspaceProps {
  readonly portraitPath?: string | null;
  readonly streamUrl?: string | null;
  readonly initialConversationId?: string | null;
  /** Id of the selected digital human; used to stop the previous human's
   * audio / stream when the selection changes. */
  readonly humanId?: string | null;
  /** Display name of the selected digital human. */
  readonly humanName?: string | null;
  /** Display name of the model used for replies, included in exports. */
  readonly modelName?: string | null;
}

/**
 * The single conversation workspace. It is used for every entry point —
 * restore, create-then-chat, switching digital humans, switching conversations
 * and creating new conversations — so all paths share one component and state
 * model. The component is a thin renderer: all state, side effects and the
 * parallel state machine live in `useConversationController`.
 */
export default function ConversationWorkspace({
  portraitPath,
  streamUrl,
  initialConversationId,
  humanId,
  humanName,
  modelName,
}: ConversationWorkspaceProps) {
  const controller = useConversationController({
    portraitPath,
    streamUrl,
    initialConversationId,
    humanId,
    humanName,
    modelName,
  });

  const {
    messages,
    visibleMessages,
    query,
    setQuery,
    error,
    conversationId,
    streaming,
    busy,
    speaking,
    isActive,
    statusLabel,
    ttsFailed,
    avatarFailed,
    recordingVoice,
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
    threadRef,
    inputRef,
    handleSend,
    handleStop,
    handleVoiceInput,
    handleStopVoiceInput,
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
  } = controller;

  return (
    <section className="conversation-workspace" aria-label="对话">
      <ConversationManagement
        selectedId={conversationId ?? undefined}
        onSelect={loadConversation}
        onCreated={handleCreated}
        onCleared={handleCleared}
        onDeleted={handleDeleted}
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
                onLoadedData={onVideoLoadedData}
                onPlay={onVideoPlay}
                onPause={onVideoPause}
                onEnded={onVideoEnded}
                onError={onVideoError}
              />
            ) : (
              <img
                src={convertFileSrc(portraitPath)}
                alt="你的数字人人像"
              />
            )}
          </div>
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
          <ConversationTimeline
            messages={visibleMessages}
            hasOlder={hasOlder}
            onLoadMore={loadMoreMessages}
            threadRef={threadRef}
            onThreadScroll={handleThreadScroll}
            busy={busy}
            editingId={editingId}
            editValue={editValue}
            onEditValueChange={setEditValue}
            onSaveEdit={handleSaveEdit}
            onCancelEdit={handleCancelEdit}
            copiedId={copiedId}
            onCopy={handleCopy}
            onEdit={handleEdit}
            onRegenerate={handleRegenerate}
            autoPlay={autoPlay}
            onAudioPlay={onAudioPlay}
            onAudioPause={onAudioPause}
            onAudioEnded={onAudioEnded}
            onAudioError={onAudioError}
            readOnly={readOnly}
            onStopPlayback={stopPlayback}
            onReplayLatest={replayLatest}
            latestAudioMessageId={latestAudioMessage?.id ?? null}
            showScrollToBottom={showScrollToBottom}
            onScrollToBottom={scrollToBottom}
          />
        )}
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
        <RecoveryBanner
          avatarFailed={avatarFailed}
          ttsFailed={ttsFailed}
          recordingVoice={recordingVoice}
          error={error}
          copiedRequestId={copiedRequestId}
          onCopyRequestId={handleCopyRequestId}
          onRetry={handleRetry}
        />
        <Composer
          query={query}
          onQueryChange={setQuery}
          onSubmit={() => void handleSend()}
          busy={busy}
          inputRef={inputRef}
          recordingVoice={recordingVoice}
          onToggleVoice={() =>
            recordingVoice
              ? void handleStopVoiceInput()
              : void handleVoiceInput()
          }
          autoPlay={autoPlay}
          onAutoPlayChange={setAutoPlay}
          readOnly={readOnly}
          onReadOnlyChange={setReadOnly}
          hasMessages={messages.length > 0}
          copiedAll={copiedAll}
          onCopyAll={handleCopyAll}
          onExport={(format) => void handleExport(format)}
          onClear={handleClear}
        />
        {formatMetricsLabel(metrics) ? (
          <p className="conversation-metrics">{formatMetricsLabel(metrics)}</p>
        ) : null}
      </div>
      <ConfirmDialog
        open={confirmingClear}
        title="清空对话"
        titleId="clear-dialog-title"
        onClose={() => setConfirmingClear(false)}
      >
        <p>
          确认清空{humanName ? `「${humanName}」的` : " "}
          当前对话？将删除当前会话的全部{" "}
          {messages.length} 条消息，此操作不可撤销。
        </p>
        <button type="button" onClick={() => setConfirmingClear(false)}>
          取消
        </button>
        <button type="button" onClick={performClear}>
          清空
        </button>
      </ConfirmDialog>
    </section>
  );
}