import { useEffect, useRef } from "react";

import type { ConversationMetrics } from "./conversationMetrics";
import type { ChatMessage } from "./conversationModel";
import {
  type ConversationUiAction,
  type ConversationUiState,
} from "./conversationStateMachine";

/**
 * TTS playback: maps <audio> element events onto the tts dimension of the
 * state machine. Playback only advances through the legal
 * ready -> playing -> completed lifecycle; the audio element is rendered by
 * the timeline, this hook only owns the event wiring, derived flags and the
 * imperative playback controls (stop playback / re-read the latest answer).
 *
 * A "ready -> playing" timing is captured so the TTS startup latency can be
 * reported alongside the other reply metrics.
 */
export function useTtsPlayback({
  ui,
  dispatch,
  onMetrics,
}: {
  readonly ui: ConversationUiState;
  readonly dispatch: React.Dispatch<ConversationUiAction>;
  readonly onMetrics?: (metrics: Partial<ConversationMetrics>) => void;
}): {
  readonly ttsFailed: boolean;
  readonly onAudioPlay: () => void;
  readonly onAudioPause: () => void;
  readonly onAudioEnded: () => void;
  readonly onAudioError: () => void;
  /** Pauses every rendered answer audio and returns tts to idle. */
  readonly stopPlayback: () => void;
  /** Re-reads the given assistant message's audio from the start. */
  readonly replayLatest: (message: ChatMessage) => void;
} {
  const ttsReadyAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (ui.tts === "ready" && ttsReadyAtRef.current === null) {
      ttsReadyAtRef.current = performance.now();
    }
  }, [ui.tts]);

  function stopPlayback(): void {
    document
      .querySelectorAll<HTMLAudioElement>("audio.conversation-message-audio")
      .forEach((node) => {
        node.pause();
      });
    dispatch({ type: "TTS_PAUSED" });
  }

  function replayLatest(message: ChatMessage): void {
    const node = document.querySelector<HTMLAudioElement>(
      `audio.conversation-message-audio[data-message-id="${message.id}"]`,
    );
    if (!node) {
      return;
    }
    node.currentTime = 0;
    void node.play();
    dispatch({ type: "TTS_PLAYING" });
  }

  return {
    ttsFailed: ui.tts === "failed",
    onAudioPlay: () => {
      const readyAt = ttsReadyAtRef.current;
      ttsReadyAtRef.current = null;
      if (readyAt !== null) {
        onMetrics?.({ ttsStartupMs: performance.now() - readyAt });
      }
      dispatch({ type: "TTS_PLAYING" });
    },
    onAudioPause: () => dispatch({ type: "TTS_PAUSED" }),
    onAudioEnded: () => dispatch({ type: "TTS_COMPLETED" }),
    onAudioError: () => dispatch({ type: "TTS_FAILED" }),
    stopPlayback,
    replayLatest,
  };
}