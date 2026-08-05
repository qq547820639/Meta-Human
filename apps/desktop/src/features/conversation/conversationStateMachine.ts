/**
 * Deterministic parallel state machine for the conversation workspace.
 *
 * The previous implementation collapsed every concern into a single
 * `phase: ConversationPhase` field plus a scatter of booleans (`streaming`,
 * `speaking`, `ttsFailed`, `avatarFailed`, `recordingVoice`). Each SSE event /
 * DOM event overwrote the shared `phase`, so "generating" and "tts playing"
 * could never coexist and a later event silently clobbered an earlier one.
 *
 * This machine models SIX independent sub-state dimensions. Each action
 * targets exactly one dimension (plus an explicit `RESET` that clears all of
 * them), so the dimensions advance in parallel and never overwrite each other:
 *
 *   - generation : text answer lifecycle (idle -> understanding/retrieving/
 *                  found_sources -> generating -> done, or stopped/error)
 *   - tts        : synthesized speech lifecycle (idle -> ready -> playing ->
 *                  completed, or failed)
 *   - avatar     : video stream lifecycle (idle -> starting -> started ->
 *                  playing -> completed, or failed)
 *   - recording  : voice input lifecycle (idle -> recording)
 *   - network    : connectivity health (online -> error)
 *   - restore    : conversation restore/switch lifecycle (idle -> restoring ->
 *                  ready)
 *
 * Stale / illegal transitions are REJECTED (the reducer returns the previous
 * dimension value unchanged) rather than silently overriding, so cancellation
 * and out-of-order events cannot corrupt the model.
 */

export type GenerationState =
  | "idle"
  | "understanding"
  | "retrieving"
  | "found_sources"
  | "generating"
  | "done";

export type TtsState =
  | "idle"
  | "ready"
  | "playing"
  | "completed"
  | "failed";

export type AvatarState =
  | "idle"
  | "starting"
  | "started"
  | "playing"
  | "completed"
  | "failed";

export type RecordingState = "idle" | "recording" | "transcribing";

export type NetworkState = "online" | "error";

export type RestoreState = "idle" | "restoring" | "ready";

export interface ConversationUiState {
  readonly generation: GenerationState;
  readonly tts: TtsState;
  readonly avatar: AvatarState;
  readonly recording: RecordingState;
  readonly network: NetworkState;
  readonly restore: RestoreState;
}

export const initialConversationUiState: ConversationUiState = {
  generation: "idle",
  tts: "idle",
  avatar: "idle",
  recording: "idle",
  network: "online",
  restore: "idle",
};

export type ConversationUiAction =
  // generation
  | { readonly type: "GENERATION_START" }
  | { readonly type: "GENERATION_STAGE"; readonly stage: "understanding" | "retrieving" }
  | { readonly type: "SOURCES_FOUND" }
  | { readonly type: "TOKEN_STARTED" }
  | { readonly type: "GENERATION_DONE" }
  | { readonly type: "GENERATION_STOPPED" }
  | { readonly type: "GENERATION_ERROR" }
  // tts
  | { readonly type: "TTS_READY" }
  | { readonly type: "TTS_PLAYING" }
  | { readonly type: "TTS_PAUSED" }
  | { readonly type: "TTS_COMPLETED" }
  | { readonly type: "TTS_FAILED" }
  // avatar
  | { readonly type: "AVATAR_STARTING" }
  | { readonly type: "AVATAR_STARTED" }
  | { readonly type: "AVATAR_PLAYING" }
  | { readonly type: "AVATAR_PAUSED" }
  | { readonly type: "AVATAR_COMPLETED" }
  | { readonly type: "AVATAR_FAILED" }
  | { readonly type: "AVATAR_RESET" }
  // recording
  | { readonly type: "RECORDING_START" }
  | { readonly type: "RECORDING_STOP" }
  // network
  | { readonly type: "NETWORK_ERROR" }
  | { readonly type: "NETWORK_OK" }
  // restore
  | { readonly type: "RESTORE_START" }
  | { readonly type: "RESTORE_DONE" }
  | { readonly type: "RESTORE_ERROR" }
  // global
  | { readonly type: "RESET" };

function generationReducer(
  state: GenerationState,
  action: ConversationUiAction,
): GenerationState {
  switch (action.type) {
    case "GENERATION_START":
      return "understanding";
    case "GENERATION_STAGE":
      return action.stage;
    case "SOURCES_FOUND":
      return "found_sources";
    // Entering the generating phase is valid from any active pre-done stage.
    case "TOKEN_STARTED":
      return state === "done" ? state : "generating";
    case "GENERATION_DONE":
      // Only a real, finished generation may become "done".
      return state === "generating" ? "done" : state;
    case "GENERATION_STOPPED":
      return state === "idle" || state === "done" ? state : "idle";
    case "GENERATION_ERROR":
    case "RESET":
      return "idle";
    default:
      return state;
  }
}

function ttsReducer(
  state: TtsState,
  action: ConversationUiAction,
): TtsState {
  switch (action.type) {
    case "TTS_READY":
      return "ready";
    case "TTS_PLAYING":
      // Audio can only start playing once it is ready.
      return state === "ready" ? "playing" : state;
    case "TTS_PAUSED":
      return state === "playing" ? "idle" : state;
    case "TTS_COMPLETED":
      return state === "playing" ? "completed" : state;
    case "TTS_FAILED":
      return "failed";
    case "RESET":
      return "idle";
    default:
      return state;
  }
}

function avatarReducer(
  state: AvatarState,
  action: ConversationUiAction,
): AvatarState {
  switch (action.type) {
    case "AVATAR_STARTING":
      return "starting";
    case "AVATAR_STARTED":
      return state === "starting" || state === "idle" ? "started" : state;
    case "AVATAR_PLAYING":
      return state === "started" ? "playing" : state;
    case "AVATAR_PAUSED":
      return state === "playing" ? "idle" : state;
    case "AVATAR_COMPLETED":
      return state === "playing" ? "completed" : state;
    case "AVATAR_FAILED":
      return "failed";
    case "AVATAR_RESET":
      return "idle";
    case "RESET":
      return "idle";
    default:
      return state;
  }
}

function recordingReducer(
  state: RecordingState,
  action: ConversationUiAction,
): RecordingState {
  switch (action.type) {
    case "RECORDING_START":
      return "recording";
    case "RECORDING_STOP":
      return "idle";
    case "RESET":
      return "idle";
    default:
      return state;
  }
}

function networkReducer(
  state: NetworkState,
  action: ConversationUiAction,
): NetworkState {
  switch (action.type) {
    case "NETWORK_ERROR":
      return "error";
    case "NETWORK_OK":
      return "online";
    case "RESET":
      return "online";
    default:
      return state;
  }
}

function restoreReducer(
  state: RestoreState,
  action: ConversationUiAction,
): RestoreState {
  switch (action.type) {
    case "RESTORE_START":
      return "restoring";
    case "RESTORE_DONE":
      return "ready";
    case "RESTORE_ERROR":
      return "idle";
    case "RESET":
      return "idle";
    default:
      return state;
  }
}

export function conversationUiReducer(
  state: ConversationUiState,
  action: ConversationUiAction,
): ConversationUiState {
  return {
    generation: generationReducer(state.generation, action),
    tts: ttsReducer(state.tts, action),
    avatar: avatarReducer(state.avatar, action),
    recording: recordingReducer(state.recording, action),
    network: networkReducer(state.network, action),
    restore: restoreReducer(state.restore, action),
  };
}

/** True while the text answer is still being produced (not idle/done). */
export function isGenerating(state: GenerationState): boolean {
  return state !== "idle" && state !== "done";
}

/** True while any media reply dimension is active (drives the status row). */
export function isUiActive(state: ConversationUiState): boolean {
  return (
    isGenerating(state.generation) ||
    state.tts !== "idle" ||
    state.avatar !== "idle"
  );
}

/** True when either the avatar video or the TTS audio is audible/on screen. */
export function isSpeaking(state: ConversationUiState): boolean {
  return state.tts === "playing" || state.avatar === "playing";
}

/** The latest user-facing status label, priority-ordered across dimensions. */
export function currentStatusLabel(
  state: ConversationUiState,
  sourcesCount: number,
): string {
  switch (state.generation) {
    case "understanding":
      return "正在理解问题";
    case "retrieving":
      return "正在检索知识";
    case "found_sources":
      return sourcesCount > 0
        ? `找到 ${sourcesCount} 个相关来源`
        : "找到相关来源";
    case "generating":
      return "正在生成回答";
    case "idle":
    case "done":
      break;
  }
  if (state.tts === "ready") {
    return "声音已准备好";
  }
  if (state.tts === "playing") {
    return "正在说话…";
  }
  if (state.avatar === "starting") {
    return "正在启动数字人";
  }
  if (state.avatar === "started") {
    return "数字人已就绪";
  }
  return "";
}