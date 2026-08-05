import VoiceControls from "./VoiceControls";
import type { ExportFormat } from "./conversationExport";

interface ComposerProps {
  readonly query: string;
  readonly onQueryChange: (value: string) => void;
  readonly onSubmit: () => void;
  readonly busy: boolean;
  readonly inputRef: React.RefObject<HTMLTextAreaElement | null>;
  readonly recordingVoice: boolean;
  readonly onToggleVoice: () => void;
  readonly autoPlay: boolean;
  readonly onAutoPlayChange: (value: boolean) => void;
  readonly readOnly: boolean;
  readonly onReadOnlyChange: (value: boolean) => void;
  readonly hasMessages: boolean;
  readonly copiedAll: boolean;
  readonly onCopyAll: () => Promise<void>;
  readonly onExport: (format: ExportFormat) => void;
  readonly onClear: () => void;
}

/**
 * The message composer: voice input, question textarea, send, autoplay toggle
 * and the transcript actions (copy all / export / clear).
 */
export default function Composer({
  query,
  onQueryChange,
  onSubmit,
  busy,
  inputRef,
  recordingVoice,
  onToggleVoice,
  autoPlay,
  onAutoPlayChange,
  readOnly,
  onReadOnlyChange,
  hasMessages,
  copiedAll,
  onCopyAll,
  onExport,
  onClear,
}: ComposerProps) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <VoiceControls
        recordingVoice={recordingVoice}
        busy={busy}
        onToggle={onToggleVoice}
      />
      <label>
        问题
        <textarea
          ref={inputRef}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="继续问你的数字人"
          disabled={busy}
          rows={2}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              onSubmit();
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
          disabled={readOnly}
          onChange={(event) => onAutoPlayChange(event.target.checked)}
        />
        自动朗读
      </label>
      <label>
        <input
          type="checkbox"
          checked={readOnly}
          onChange={(event) => onReadOnlyChange(event.target.checked)}
        />
        只生成文字
      </label>
      {hasMessages ? (
        <>
          <button type="button" onClick={() => void onCopyAll()}>
            {copiedAll ? "已复制全部" : "复制全部"}
          </button>
          <button type="button" onClick={() => onExport("markdown")}>
            导出 Markdown
          </button>
          <button type="button" onClick={() => onExport("json")}>
            导出 JSON
          </button>
          <button type="button" onClick={onClear}>
            清空对话
          </button>
        </>
      ) : null}
    </form>
  );
}