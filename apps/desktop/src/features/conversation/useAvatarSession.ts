import { useEffect, useRef } from "react";

import type { ConversationMetrics } from "./conversationMetrics";
import {
  type ConversationUiAction,
  type ConversationUiState,
} from "./conversationStateMachine";

/**
 * Avatar session: wires the <video> stream element events onto the avatar
 * dimension of the state machine and resets the failed flag whenever a new
 * stream URL arrives (a fresh human/stream should not inherit a stale error).
 *
 * The time from when a stream URL is provided until the video reports it has
 * loaded the data is captured as the avatar readiness metric.
 */
export function useAvatarSession({
  ui,
  dispatch,
  streamUrl,
  onMetrics,
}: {
  readonly ui: ConversationUiState;
  readonly dispatch: React.Dispatch<ConversationUiAction>;
  readonly streamUrl?: string | null;
  readonly onMetrics?: (metrics: Partial<ConversationMetrics>) => void;
}): {
  readonly avatarFailed: boolean;
  readonly onVideoLoadedData: () => void;
  readonly onVideoPlay: () => void;
  readonly onVideoPause: () => void;
  readonly onVideoEnded: () => void;
  readonly onVideoError: () => void;
} {
  const streamStartRef = useRef(0);

  useEffect(() => {
    dispatch({ type: "AVATAR_RESET" });
    if (streamUrl) {
      streamStartRef.current = performance.now();
    }
  }, [streamUrl, dispatch]);

  return {
    avatarFailed: ui.avatar === "failed",
    onVideoLoadedData: () => {
      if (streamStartRef.current !== 0) {
        onMetrics?.({ avatarReadyMs: performance.now() - streamStartRef.current });
        streamStartRef.current = 0;
      }
      dispatch({ type: "AVATAR_STARTED" });
    },
    onVideoPlay: () => dispatch({ type: "AVATAR_PLAYING" }),
    onVideoPause: () => dispatch({ type: "AVATAR_PAUSED" }),
    onVideoEnded: () => dispatch({ type: "AVATAR_COMPLETED" }),
    onVideoError: () => dispatch({ type: "AVATAR_FAILED" }),
  };
}