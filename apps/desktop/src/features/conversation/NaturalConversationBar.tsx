import type { NaturalConversationState } from "./natural/naturalConversationStateMachine";

interface NaturalConversationBarProps {
  readonly naturalActive: boolean;
  readonly naturalStatus: string;
  readonly naturalTranscript: string;
  readonly naturalMode: "natural" | "push_to_talk";
  readonly naturalSttAvailable: boolean;
  readonly naturalState: NaturalConversationState;
  readonly onEnableNatural: () => void;
  readonly onDisableNatural: () => void;
  readonly onSetMode: (mode: "natural" | "push_to_talk") => void;
  readonly onRetry: () => void;
  readonly onTranscriptEdit: (text: string) => void;
  readonly onTranscriptConfirm: () => void;
  readonly onInterrupt: () => void;
}

/**
 * Hands-free conversation controls: a mode toggle, the live phase indicator
 * (listening / thinking / speaking / reconnecting / interrupted / error), an
 * editable interim transcript, and a confirm / interrupt affordance. The phase
 * label and transcript are driven entirely by the natural state machine.
 */
export default function NaturalConversationBar({
  naturalActive,
  naturalStatus,
  naturalTranscript,
  naturalMode,
  naturalSttAvailable,
  naturalState,
  onEnableNatural,
  onDisableNatural,
  onSetMode,
  onRetry,
  onTranscriptEdit,
  onTranscriptConfirm,
  onInterrupt,
}: NaturalConversationBarProps) {
  if (!naturalActive) {
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
              onSetMode(event.target.value as "natural" | "push_to_talk")
            }
          >
            <option value="natural">自然对话（自动）</option>
            <option value="push_to_talk">按住说话</option>
          </select>
        </label>
      </div>
    );
  }

  const editable = naturalState.phase === "listening" || naturalState.phase === "transcribing";

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
        <button
          type="button"
          onClick={onTranscriptConfirm}
          disabled={naturalTranscript.trim() === ""}
        >
          确认发送
        </button>
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
    </div>
  );
}