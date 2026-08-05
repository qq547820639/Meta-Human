import { describe, expect, it } from "vitest";

import {
  conversationUiReducer,
  currentStatusLabel,
  initialConversationUiState,
  isGenerating,
  isSpeaking,
  isUiActive,
  type ConversationUiState,
} from "./conversationStateMachine";

function apply(state: ConversationUiState, ...actions: Parameters<typeof conversationUiReducer>[1][]) {
  return actions.reduce(
    (acc, action) => conversationUiReducer(acc, action),
    state,
  );
}

describe("conversationUiReducer — parallel state machine", () => {
  it("moves generation idle -> understanding -> retrieving -> found_sources -> generating -> done", () => {
    const state = apply(
      initialConversationUiState,
      { type: "GENERATION_START" },
      { type: "GENERATION_STAGE", stage: "retrieving" },
      { type: "SOURCES_FOUND" },
      { type: "TOKEN_STARTED" },
      { type: "GENERATION_DONE" },
    );
    expect(state.generation).toBe("done");
    expect(isGenerating(state.generation)).toBe(false);
  });

  it("moves tts idle -> ready -> playing -> completed", () => {
    const state = apply(
      initialConversationUiState,
      { type: "TTS_READY" },
      { type: "TTS_PLAYING" },
      { type: "TTS_COMPLETED" },
    );
    expect(state.tts).toBe("completed");
  });

  it("moves generation generating -> stopped (back to idle)", () => {
    const state = apply(
      initialConversationUiState,
      { type: "GENERATION_START" },
      { type: "TOKEN_STARTED" },
      { type: "GENERATION_STOPPED" },
    );
    expect(state.generation).toBe("idle");
    expect(isGenerating(state.generation)).toBe(false);
  });

  it("moves recording idle -> recording -> idle", () => {
    const state = apply(
      initialConversationUiState,
      { type: "RECORDING_START" },
      { type: "RECORDING_STOP" },
    );
    expect(state.recording).toBe("idle");
  });

  it("rejects GENERATION_DONE unless the generation is actually generating", () => {
    // Calling DONE from idle must not silently produce "done".
    let state = apply(initialConversationUiState, { type: "GENERATION_DONE" });
    expect(state.generation).toBe("idle");

    // From "understanding" (no token yet) DONE is also illegal.
    state = apply(
      initialConversationUiState,
      { type: "GENERATION_START" },
      { type: "GENERATION_DONE" },
    );
    expect(state.generation).toBe("understanding");
  });

  it("rejects TTS_PLAYING before the audio is ready", () => {
    const state = apply(initialConversationUiState, { type: "TTS_PLAYING" });
    expect(state.tts).toBe("idle");
  });

  it("rejects AVATAR completions before the avatar is playing", () => {
    let state = apply(initialConversationUiState, { type: "AVATAR_COMPLETED" });
    expect(state.avatar).toBe("idle");

    state = apply(
      initialConversationUiState,
      { type: "AVATAR_STARTED" },
      { type: "AVATAR_COMPLETED" },
    );
    expect(state.avatar).toBe("started");
  });

  it("normalizes out-of-order TTS/avatar events without corrupting generation", () => {
    const state = apply(
      initialConversationUiState,
      { type: "GENERATION_START" },
      { type: "TOKEN_STARTED" },
      // A stale audio-complete event arrives before any audio started.
      { type: "TTS_COMPLETED" },
      { type: "TTS_READY" },
      { type: "TTS_PLAYING" },
    );
    // generation stayed generating; tts advanced independently.
    expect(state.generation).toBe("generating");
    expect(state.tts).toBe("playing");
  });

  it("keeps generation and tts independent (parallel dimensions)", () => {
    const state = apply(
      initialConversationUiState,
      { type: "GENERATION_START" },
      { type: "TOKEN_STARTED" },
      { type: "TTS_READY" },
      { type: "TTS_PLAYING" },
    );
    // Both advanced in parallel; neither was overwritten by the other.
    expect(state.generation).toBe("generating");
    expect(state.tts).toBe("playing");
    expect(isSpeaking(state)).toBe(true);
    expect(isUiActive(state)).toBe(true);
  });

  it("does not let generation reset clobber an independent tts playback", () => {
    const state = apply(
      initialConversationUiState,
      { type: "TTS_READY" },
      { type: "TTS_PLAYING" },
      { type: "RECORDING_START" },
    );
    // RECORDING_START only touches the recording dimension.
    expect(state.tts).toBe("playing");
    expect(state.recording).toBe("recording");
  });

  it("RESET clears every dimension at once", () => {
    const busy = apply(
      initialConversationUiState,
      { type: "GENERATION_START" },
      { type: "TOKEN_STARTED" },
      { type: "TTS_READY" },
      { type: "TTS_PLAYING" },
      { type: "RECORDING_START" },
      { type: "NETWORK_ERROR" },
      { type: "RESTORE_START" },
    );
    const reset = apply(busy, { type: "RESET" });
    expect(reset).toEqual(initialConversationUiState);
  });

  it("derives the status label with source count for found_sources", () => {
    const found = apply(initialConversationUiState, { type: "SOURCES_FOUND" });
    expect(currentStatusLabel(found, 3)).toBe("找到 3 个相关来源");
    expect(currentStatusLabel(found, 0)).toBe("找到相关来源");
    expect(currentStatusLabel(initialConversationUiState, 0)).toBe("");
  });
});