import { useEffect, useReducer, useRef, useState } from "react";

import type { ConversationMetrics } from "./conversationMetrics";
import type {
  ConversationUiAction,
  ConversationUiState,
} from "./conversationStateMachine";
import type { AvatarSession } from "./avatarClient";
import {
  deriveStaticPose,
  initialPresentationState,
  MAX_RECONNECT_ATTEMPTS,
  noPresentationCapabilities,
  presentationLifecycleReducer,
  RECONNECT_DELAY_MS,
  resolvePresentationParams,
  type PresentationAction,
  type PresentationCapabilities,
  type PresentationParams,
  type PresentationRequest,
  type PresentationState,
  type StaticPose,
} from "./avatarPresentationLifecycle";

export interface UseAvatarPresentationDeps {
  readonly ui: ConversationUiState;
  readonly dispatch: React.Dispatch<ConversationUiAction>;
  /** The active avatar stream session (its `streamUrl` drives the `<video>`). */
  readonly session?: AvatarSession | null;
  readonly onMetrics?: (metrics: Partial<ConversationMetrics>) => void;
  /** Provider capability probe; unsupported capabilities are never sent. */
  readonly capabilities?: PresentationCapabilities;
  /** Presentation tuning params (lip-sync / emotion) requested by the caller. */
  readonly request?: PresentationRequest;
  /** True while natural (hands-free) conversation is active — drives listening. */
  readonly listening?: boolean;
}

export interface UseAvatarPresentationResult {
  readonly presentation: PresentationState;
  readonly staticPose: StaticPose;
  readonly params: PresentationParams;
  readonly avatarFailed: boolean;
  /** Increments whenever a live stream must be (re)mounted (recovery/rebuild). */
  readonly rebuildNonce: number;
  readonly onVideoLoadedData: () => void;
  readonly onVideoPlay: () => void;
  readonly onVideoPause: () => void;
  readonly onVideoEnded: () => void;
  readonly onVideoError: () => void;
  /** Tear down the current presentation (switch human / conversation / unmount). */
  readonly cleanup: () => void;
}

/**
 * Unified digital-human presentation. Owns the video-stream lifecycle
 * (`loading -> buffering -> playing -> reconnecting -> fallback -> error`) and
 * wires the `<video>` element events onto BOTH the avatar dimension of the
 * parallel state machine and the presentation lifecycle. It also handles the
 * recovery/rebuild paths driven by visibility and network events, resets itself
 * when the human or conversation switches, and resolves the provider capability
 * parameters (AV sync / lip-sync / emotion) that are forwarded only when the
 * provider supports them.
 *
 * When the stream fails, the text answer and the TTS audio are preserved — the
 * presentation merely degrades to the static portrait (fallback), never dropping
 * the already-produced answer.
 */
export function useAvatarPresentation({
  ui,
  dispatch,
  session,
  onMetrics,
  capabilities = noPresentationCapabilities,
  request,
  listening = false,
}: UseAvatarPresentationDeps): UseAvatarPresentationResult {
  const streamUrl = session?.streamUrl ?? null;
  const [presentation, dispatchPresentation] = useReducer(
    presentationLifecycleReducer,
    undefined,
    (): PresentationState =>
      streamUrl
        ? { stage: "loading", mode: "live", reconnectAttempts: 0 }
        : initialPresentationState,
  );
  const [rebuildNonce, setRebuildNonce] = useState(0);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const streamStartRef = useRef(0);
  const sessionStartRef = useRef(0);
  const reconnectStartRef = useRef(0);
  const prevSessionKeyRef = useRef(`${session?.sessionId ?? ""}:${streamUrl ?? ""}`);
  const presentationRef = useRef(presentation);
  presentationRef.current = presentation;

  // A brand-new session (or stream URL) begins a fresh live presentation.
  useEffect(() => {
    const key = `${session?.sessionId ?? ""}:${streamUrl ?? ""}`;
    if (key === prevSessionKeyRef.current) {
      return;
    }
    prevSessionKeyRef.current = key;
    streamStartRef.current = performance.now();
    sessionStartRef.current = performance.now();
    reconnectStartRef.current = 0;
    dispatchPresentation({ type: "PRESENT_START" });
  }, [session?.sessionId, streamUrl]);

  // Surface the session's honest terminal states onto the presentation.
  useEffect(() => {
    if (session?.status === "auth-expired") {
      dispatchPresentation({ type: "PRESENT_AUTH_EXPIRED" });
    } else if (session?.status === "expired") {
      dispatchPresentation({ type: "PRESENT_STREAM_EXPIRED" });
    }
  }, [session?.status]);

  // Clear any pending reconnect timer on unmount.
  useEffect(
    () => () => {
      if (reconnectTimeoutRef.current !== null) {
        window.clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    },
    [],
  );

  const params = resolvePresentationParams(request, capabilities);
  const staticPose = deriveStaticPose(ui, { listening });

  function requestRebuild(): void {
    setRebuildNonce((nonce) => nonce + 1);
  }

  function scheduleReconnect(): void {
    if (reconnectTimeoutRef.current !== null) {
      window.clearTimeout(reconnectTimeoutRef.current);
    }
    reconnectTimeoutRef.current = window.setTimeout(() => {
      reconnectTimeoutRef.current = null;
      // Remount the media element (new key) so the stream is rebuilt.
      requestRebuild();
      dispatchPresentation({ type: "PRESENT_RECONNECTED" });
    }, RECONNECT_DELAY_MS);
  }

  function onVideoLoadedData(): void {
    if (streamStartRef.current !== 0) {
      onMetrics?.({ avatarReadyMs: performance.now() - streamStartRef.current });
      streamStartRef.current = 0;
    }
    if (sessionStartRef.current !== 0) {
      onMetrics?.({
        avatarSessionToFirstFrameMs: performance.now() - sessionStartRef.current,
      });
      sessionStartRef.current = 0;
    }
    dispatch({ type: "AVATAR_STARTED" });
    dispatchPresentation({ type: "PRESENT_LOADED" });
  }

  function onVideoPlay(): void {
    if (reconnectStartRef.current !== 0) {
      onMetrics?.({ avatarReconnectMs: performance.now() - reconnectStartRef.current });
      reconnectStartRef.current = 0;
    }
    dispatch({ type: "AVATAR_PLAYING" });
    dispatchPresentation({ type: "PRESENT_PLAYING" });
  }

  function onVideoPause(): void {
    dispatch({ type: "AVATAR_PAUSED" });
  }

  function onVideoEnded(): void {
    dispatch({ type: "AVATAR_COMPLETED" });
    // The live stream ended; degrade to the static portrait. The text answer
    // and any TTS audio already produced are preserved.
    dispatchPresentation({ type: "PRESENT_FALLBACK" });
  }

  function onVideoError(): void {
    dispatch({ type: "AVATAR_FAILED" });
    const reconnectAttempts = presentationRef.current.reconnectAttempts;
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      reconnectStartRef.current = performance.now();
      dispatchPresentation({ type: "PRESENT_RECONNECT" });
      scheduleReconnect();
    } else {
      // Give up; show the static portrait while keeping the answer + audio.
      dispatchPresentation({ type: "PRESENT_FALLBACK" });
    }
  }

  // Recovery / rebuild driven by visibility and network events.
  useEffect(() => {
    function onVisibilityChange(): void {
      if (document.hidden) {
        return;
      }
      // The page became visible again; if we were not playing a live stream,
      // rebuild it so the presentation resumes cleanly after a tab switch.
      if (streamUrl && presentationRef.current.stage !== "playing") {
        dispatchPresentation({ type: "PRESENT_RECONNECT" });
        requestRebuild();
      }
    }
    function onOnline(): void {
      // Network returned; re-establish a stream that was stuck reconnecting or
      // degraded to static fallback.
      const stage = presentationRef.current.stage;
      if (stage === "reconnecting" || stage === "fallback") {
        if (streamUrl) {
          dispatchPresentation({ type: "PRESENT_RECONNECT" });
          requestRebuild();
        }
      }
    }
    function onOffline(): void {
      const stage = presentationRef.current.stage;
      if (stage === "playing" || stage === "buffering") {
        dispatchPresentation({ type: "PRESENT_RECONNECT" });
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [streamUrl]);

  function cleanup(): void {
    if (reconnectTimeoutRef.current !== null) {
      window.clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    dispatchPresentation({ type: "PRESENT_RESET" });
  }

  return {
    presentation,
    staticPose,
    params,
    avatarFailed: ui.avatar === "failed",
    rebuildNonce,
    onVideoLoadedData,
    onVideoPlay,
    onVideoPause,
    onVideoEnded,
    onVideoError,
    cleanup,
  };
}

export type { PresentationAction };