import type {
  NaturalConversationState,
  NaturalInputMode,
} from "./natural/naturalConversationStateMachine";

interface NaturalConversationBarProps {
  readonly naturalActive: boolean;
  readonly naturalStatus: string;
  readonly naturalTranscript: string;
  readonly naturalMode: NaturalInputMode;
  readonly naturalSttAvailable: boolean;
  /** Recommended default input mode from real device capability probing. */
  readonly recommendedMode: NaturalInputMode;
  /** True when the browser rejected microphone permission. */
  readonly micDenied: boolean;
  /** Human-readable reason for the permission denial, if any. */
  readonly micDeniedReason: string | null;
  readonly naturalState: NaturalConversationState;
  readonly onEnableNatural: () => void;
  readonly onDisableNatural: () => void;
  readonly onSetMode: (mode: NaturalInputMode) => void;
  readonly onRetry: () => void;
  readonly onTranscriptEdit: (text: string) => void;
  readonly onTranscriptConfirm: () => void;
  readonly onInterrupt: () => void;
  /** Opens the OS microphone privacy settings (permission-denied recovery). */
  readonly onOpenMicSettings: () => void;
}

const MODE_LABELS: Record<NaturalInputMode, string> = {
  natural: "自然对话（自动）",
  push_to_talk: "按住说话",
  text_only: "纯文字",
};

/**
 * Hands-free conversation controls: a mode toggle, the live phase indicator
 * (listening / transcribing / thinking / generating-voice / speaking /
 * reconnecting / interrupted / error), an editable interim transcript with a
 * clear affordance, and a confirm / interrupt / retry affordance. The phase
 * label and transcript are driven entirely by the natural state machine.
 *
 * When the microphone permission is denied, a clear message names the
 * permission, explains the browser blocked it, and offers a button that opens
 * the OS microphone settings. When speech is unavailable (no STT / mic denied /
 * text_only mode), the bar shows a "已降级为文字" hint so the user knows to type.
 */
export default function NaturalConversationBar({
  naturalActive,
  naturalStatus,
  naturalTranscript,
  naturalMode,
  naturalSttAvailable,
  recommendedMode,
  micDenied,
  micDeniedReason,
  naturalState,
  onEnableNatural,
  onDisableNatural,
  onSetMode,
  onRetry,
  onTranscriptEdit,
  onTranscriptConfirm,
  onInterrupt,
  onOpenMicSettings,
}: NaturalConversationBarProps) {
  // Degraded to plain text when speech input is impossible (no STT engine,
  // mic permission denied, or the user explicitly chose text_only).
  const degradedToText =
    !naturalSttAvailable || micDenied || naturalMode === "text_only";

  const permissionDeniedPanel = micDenied ? (
    <div
      className="natural-mic-denied"
      role="alert"
      aria-label="麦克风权限被拒绝"
    >
      <p>
        {micDeniedReason ??
          "麦克风权限被拒绝，无法进行语音对话；可使用纯文字输入。"}
      </p>
      <button type="button" onClick={onOpenMicSettings}>
        打开系统麦克风设置
      </button>
    </div>
  ) : null;

  const degradedHint = degradedToText ? (
    <p className="natural-degraded-hint">
      已降级为文字
      {naturalMode === "text_only"
        ? "（当前为纯文字输入）"
        : micDenied
          ? "（麦克风权限被拒绝）"
          : "（当前环境无语音识别）"}
    </p>
  ) : null;

  if (!naturalActive) {
    const recommendedHint =
      recommendedMode !== naturalMode ? (
        <p className="natural-recommend-hint">
          建议：{MODE_LABELS[recommendedMode]}
        </p>
      ) : null;
    return (
      <div className="natural-conversation-bar">
        <button
          type="button"
          onClick={onEnableNatural}
          title={
            naturalSttAvailable
              ? "开启自然对话（麦克风常开，自动识别开始/结束说话）"
              : "当前环境无语音识别引擎，将降级为按住说话"
          }
        >
          开启自然对话
        </button>
        <label>
          输入方式
          <select
            value={naturalMode}
            onChange={(event) =>
              onSetMode(event.target.value as NaturalInputMode)
            }
          >
            {(Object.keys(MODE_LABELS) as NaturalInputMode[]).map((mode) => (
              <option key={mode} value={mode}>
                {MODE_LABELS[mode]}
              </option>
            ))}
          </select>
        </label>
        {recommendedHint}
        {permissionDeniedPanel}
        {degradedHint}
      </div>
    );
  }

  const editable =
    naturalState.phase === "listening" ||
    naturalState.phase === "transcribing";

  return (
    <div className={`natural-conversation-bar natural-${naturalState.phase}`}>
      <button type="button" onClick={onDisableNatural}>
        关闭自然对话
      </button>
      <span
        className="natural-status"
        role="status"
        aria-live="polite"
        aria-label="自然对话状态"
      >
        {naturalStatus}
      </span>
      {editable ? (
        <label>
          临时转写
          <textarea
            value={naturalTranscript}
            onChange={(event) => onTranscriptEdit(event.target.value)}
            rows={1}
            placeholder="正在聆听…"
            aria-live="polite"
            aria-label="语音转写临时文本"
          />
        </label>
      ) : null}
      {editable && naturalTranscript.trim() ? (
        <>
          <button
            type="button"
            onClick={() => onTranscriptEdit("")}
            title="清空并撤销本次转写"
          >
            清空
          </button>
          <button
            type="button"
            onClick={onTranscriptConfirm}
            disabled={naturalTranscript.trim() === ""}
          >
            确认发送
          </button>
        </>
      ) : null}
      {naturalState.phase === "speaking" ||
      naturalState.phase === "thinking" ? (
        <button type="button" onClick={onInterrupt}>
          打断
        </button>
      ) : null}
      {naturalState.phase === "error" ? (
        <button type="button" onClick={onRetry}>
          重试
        </button>
      ) : null}
      {permissionDeniedPanel}
      {degradedHint}
    </div>
  );
}