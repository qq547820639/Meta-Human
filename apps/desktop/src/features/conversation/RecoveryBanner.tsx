import type { ChatError } from "./conversationModel";

interface RecoveryBannerProps {
  readonly avatarFailed: boolean;
  readonly ttsFailed: boolean;
  readonly recordingVoice: boolean;
  readonly error: ChatError | null;
  readonly copiedRequestId: boolean;
  readonly onCopyRequestId: () => Promise<void>;
  readonly onRetry: () => void;
}

/**
 * Non-blocking recovery surfaces: avatar / tts fallback notices, the unified
 * error banner (with retryable state, recommended action and copyable request
 * id) and the recording status. It never removes the failed message from view.
 */
export default function RecoveryBanner({
  avatarFailed,
  ttsFailed,
  recordingVoice,
  error,
  copiedRequestId,
  onCopyRequestId,
  onRetry,
}: RecoveryBannerProps) {
  return (
    <>
      {avatarFailed ? (
        <>
          <p className="conversation-stream-fallback" role="status">
            数字人暂不可用，已切换为语音播放。
          </p>
          <p className="conversation-action-hint" role="status">
            前往数字人管理页重新选择数字人。
          </p>
        </>
      ) : null}
      {ttsFailed ? (
        <>
          <p className="conversation-tts-fallback" role="status">
            语音生成失败，已保留文字回答。
          </p>
          <p className="conversation-action-hint" role="status">
            检查语音设置后重试。
          </p>
        </>
      ) : null}
      {recordingVoice ? <p role="status">正在录音…</p> : null}
      {error ? (
        <div className="conversation-error" role="alert">
          <p>{error.message}</p>
          {error.retryable ? <p>此错误可重试。</p> : null}
          {error.recommendedAction ? <p>{error.recommendedAction}</p> : null}
          {error.requestId ? (
            <button type="button" onClick={() => void onCopyRequestId()}>
              {copiedRequestId ? "已复制请求编号" : "复制请求编号"}
            </button>
          ) : null}
        </div>
      ) : null}
      {error && error.retryable ? (
        <button type="button" onClick={onRetry}>
          重试
        </button>
      ) : null}
    </>
  );
}