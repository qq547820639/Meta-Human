import { useState } from "react";

import {
  deleteMediaFile,
  startRecording,
  stopRecording,
} from "../creation/captureClient";
import { transcribeRecording } from "./conversationClient";
import type { ConversationUiAction } from "./conversationStateMachine";
import type { ChatError } from "./conversationModel";

export interface UseVoiceRecordingDeps {
  readonly dispatch: React.Dispatch<ConversationUiAction>;
  readonly setError: (error: ChatError | null) => void;
  readonly setQuery: (query: string) => void;
  readonly focusInput: () => void;
}

export interface UseVoiceRecordingResult {
  readonly recordingVoice: boolean;
  readonly startVoiceInput: () => Promise<void>;
  readonly stopVoiceInput: () => Promise<void>;
}

/**
 * Voice input lifecycle: startRecording -> stopRecording -> transcribe ->
 * delete temp media. The recording dimension of the state machine tracks
 * whether a capture is in progress, independent of generation / tts.
 */
export function useVoiceRecording({
  dispatch,
  setError,
  setQuery,
  focusInput,
}: UseVoiceRecordingDeps): UseVoiceRecordingResult {
  const [recordingVoice, setRecordingVoice] = useState(false);

  async function startVoiceInput(): Promise<void> {
    setError(null);
    try {
      await startRecording();
      setRecordingVoice(true);
      dispatch({ type: "RECORDING_START" });
    } catch {
      setError({ message: "无法开始录音，请检查麦克风后重试。", retryable: false });
    }
  }

  async function stopVoiceInput(): Promise<void> {
    setError(null);
    let audioPath: string | null = null;
    try {
      audioPath = await stopRecording();
      dispatch({ type: "RECORDING_STOP" });
      const text = await transcribeRecording(audioPath);
      if (!text.trim()) {
        setError({ message: "没有听清，请再试一次。", retryable: false });
        return;
      }
      setQuery(text);
      focusInput();
    } catch {
      setError({ message: "语音识别失败，请检查麦克风后重试。", retryable: true });
    } finally {
      // Always delete the temp recording, even when transcription fails or was
      // cancelled, so no temp media file is leaked.
      if (audioPath) {
        await deleteMediaFile(audioPath).catch(() => {
          // Best-effort cleanup of the temp recording; a failure here must not
          // mask or override the transcription result already being shown.
        });
      }
      setRecordingVoice(false);
      dispatch({ type: "RECORDING_STOP" });
    }
  }

  return { recordingVoice, startVoiceInput, stopVoiceInput };
}