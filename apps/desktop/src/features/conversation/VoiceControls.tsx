interface VoiceControlsProps {
  readonly recordingVoice: boolean;
  readonly busy: boolean;
  readonly onToggle: () => void;
}

/**
 * Single source of truth for the voice-input toggle button used by the
 * composer. Renders "语音提问" / "停止录音" from the recording dimension.
 */
export default function VoiceControls({
  recordingVoice,
  busy,
  onToggle,
}: VoiceControlsProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={busy}
    >
      {recordingVoice ? "停止录音" : "语音提问"}
    </button>
  );
}