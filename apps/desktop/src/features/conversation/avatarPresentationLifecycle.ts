/**
 * Unified digital-human presentation lifecycle (Task 6).
 *
 * The parallel conversation state machine models text generation, TTS and the
 * avatar video stream as independent dimensions. This module adds a single,
 * higher-level presentation lifecycle on top of those dimensions so the whole
 * "present a digital human" concern — the live video stream, the synthesized
 * speech and the text generation — is driven by ONE state machine instead of a
 * scatter of ad-hoc booleans.
 *
 * Supported stages (the full degradation ladder):
 *
 *   loading      -> a live stream session is being established
 *   buffering    -> the media element has loaded data but is not playing yet
 *   playing      -> the live stream / speech is being presented
 *   reconnecting -> the stream dropped and we are waiting to rebuild it
 *   fallback     -> no playable stream; the static portrait is shown while the
 *                   text answer and audio are preserved (answer is never lost)
 *   error        -> an unrecoverable presentation error
 *
 * The machine is intentionally small and pure so it can be unit-tested without
 * React. It also derives the "static pose" (idle / listening / thinking /
 * speaking) used to animate the static portrait, and resolves the provider
 * capabilities (audio/video sync, lip-sync, emotion) that are forwarded only
 * when the provider actually supports them.
 */

import { isGenerating, type ConversationUiState } from "./conversationStateMachine";

export type PresentationStage =
  | "loading"
  | "buffering"
  | "playing"
  | "reconnecting"
  | "fallback"
  | "error";

/** Live stream is on screen; otherwise the static portrait is shown. */
export type PresentationMode = "live" | "static";

export type StaticPose = "idle" | "listening" | "thinking" | "speaking";

export interface PresentationState {
  readonly stage: PresentationStage;
  readonly mode: PresentationMode;
  readonly reconnectAttempts: number;
}

export const initialPresentationState: PresentationState = {
  stage: "fallback",
  mode: "static",
  reconnectAttempts: 0,
};

/** How many times a dropped stream is re-established before static fallback. */
export const MAX_RECONNECT_ATTEMPTS = 2;
/** Delay (ms) before a dropped stream is re-established. */
export const RECONNECT_DELAY_MS = 1500;

export type PresentationAction =
  /** A fresh stream session is starting (new URL / rebuild). */
  | { readonly type: "PRESENT_START" }
  /** The media element has loaded its first data chunk. */
  | { readonly type: "PRESENT_LOADED" }
  /** The media element is actually playing. */
  | { readonly type: "PRESENT_PLAYING" }
  /** The stream dropped; increment the reconnect attempt counter. */
  | { readonly type: "PRESENT_RECONNECT" }
  /** A rebuild was issued; the new stream is loading again. */
  | { readonly type: "PRESENT_RECONNECTED" }
  /** Give up reconnecting and show the static portrait fallback. */
  | { readonly type: "PRESENT_FALLBACK" }
  /** An unrecoverable presentation error occurred. */
  | { readonly type: "PRESENT_ERROR" }
  /** Switching human / conversation: tear the presentation down. */
  | { readonly type: "PRESENT_RESET" };

export function presentationLifecycleReducer(
  state: PresentationState,
  action: PresentationAction,
): PresentationState {
  switch (action.type) {
    case "PRESENT_START":
      return { stage: "loading", mode: "live", reconnectAttempts: 0 };
    case "PRESENT_LOADED":
      if (state.stage === "loading" || state.stage === "reconnecting") {
        return { stage: "buffering", mode: "live", reconnectAttempts: state.reconnectAttempts };
      }
      return state;
    case "PRESENT_PLAYING":
      if (state.stage === "buffering" || state.stage === "loading") {
        return { stage: "playing", mode: "live", reconnectAttempts: state.reconnectAttempts };
      }
      return state;
    case "PRESENT_RECONNECT":
      if (state.stage === "playing" || state.stage === "buffering") {
        return { stage: "reconnecting", mode: "live", reconnectAttempts: state.reconnectAttempts + 1 };
      }
      return state;
    case "PRESENT_RECONNECTED":
      if (state.stage === "reconnecting") {
        return { stage: "loading", mode: "live", reconnectAttempts: state.reconnectAttempts };
      }
      return state;
    case "PRESENT_FALLBACK":
      return { stage: "fallback", mode: "static", reconnectAttempts: state.reconnectAttempts };
    case "PRESENT_ERROR":
      return { stage: "error", mode: "static", reconnectAttempts: state.reconnectAttempts };
    case "PRESENT_RESET":
      return initialPresentationState;
    default:
      return state;
  }
}

/**
 * Derives the natural static pose from the parallel conversation state. The
 * static portrait degrades gracefully: it speaks while TTS plays, thinks while
 * the answer is being generated and listens while voice input / natural
 * conversation is active.
 */
export function deriveStaticPose(
  ui: ConversationUiState,
  opts: { readonly listening?: boolean } = {},
): StaticPose {
  if (ui.tts === "playing" || ui.avatar === "playing") {
    return "speaking";
  }
  if (isGenerating(ui.generation)) {
    return "thinking";
  }
  if (opts.listening || ui.recording === "recording") {
    return "listening";
  }
  return "idle";
}

/** Provider capabilities that gate which presentation parameters are sent. */
export interface PresentationCapabilities {
  readonly audioVideoSync: boolean;
  readonly lipSync: boolean;
  readonly emotion: boolean;
}

export const noPresentationCapabilities: PresentationCapabilities = {
  audioVideoSync: false,
  lipSync: false,
  emotion: false,
};

/** Parameters the caller would like to forward to the provider (if supported). */
export interface PresentationRequest {
  readonly lipSync?: boolean;
  readonly emotion?: boolean;
}

/** The resolved parameters that will actually be forwarded to the provider. */
export interface PresentationParams {
  /** Audio/video (AV) sync is enabled (drives timestamp alignment). */
  readonly syncEnabled: boolean;
  /** Lip-sync is enabled (only when the provider supports it). */
  readonly lipSync: boolean;
  /** Emotion is enabled (only when the provider supports it). */
  readonly emotion: boolean;
}

/**
 * Resolves the requested presentation parameters against the provider's
 * capabilities. A capability the provider does not expose is silently ignored
 * (never passed), so capability probing over a thin provider never breaks the
 * stream — the default, capability-less adapter forwards no parameters at all.
 */
export function resolvePresentationParams(
  request: PresentationRequest | undefined,
  capabilities: PresentationCapabilities,
): PresentationParams {
  return {
    syncEnabled: capabilities.audioVideoSync,
    lipSync: capabilities.lipSync && Boolean(request?.lipSync),
    emotion: capabilities.emotion && Boolean(request?.emotion),
  };
}