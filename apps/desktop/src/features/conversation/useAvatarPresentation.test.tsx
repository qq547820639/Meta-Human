import { useReducer } from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  initialPresentationState,
  noPresentationCapabilities,
  RECONNECT_DELAY_MS,
} from "./avatarPresentationLifecycle";
import {
  conversationUiReducer,
  initialConversationUiState,
} from "./conversationStateMachine";
import {
  useAvatarPresentation,
  type UseAvatarPresentationDeps,
} from "./useAvatarPresentation";
import type { AvatarSession } from "./avatarClient";

function session(streamUrl: string | null): AvatarSession {
  return {
    sessionId: "sess-1",
    streamUrl,
    avatarId: "a1",
    voiceId: "v1",
    status: "ready",
    createdAt: Date.now(),
  };
}

/** Preserves the old `streamUrl` shorthand for the presentation tests. */
function live(
  streamUrl: string,
): Omit<UseAvatarPresentationDeps, "ui" | "dispatch"> {
  return { session: session(streamUrl) };
}

function useHarness(props: Omit<UseAvatarPresentationDeps, "ui" | "dispatch">) {
  const [ui, dispatch] = useReducer(
    conversationUiReducer,
    initialConversationUiState,
  );
  return useAvatarPresentation({ ...props, ui, dispatch });
}

afterEach(() => {
  vi.useRealTimers();
});

/** Drives a live stream through a drop + rebuild so the caller lands at playing. */
function dropAndRebuild(hook: { current: ReturnType<typeof useHarness> }) {
  act(() => hook.current.onVideoError());
  act(() => vi.advanceTimersByTime(RECONNECT_DELAY_MS));
  act(() => hook.current.onVideoLoadedData());
  act(() => hook.current.onVideoPlay());
}

/** Drives the stream into the static fallback (3 drops exhaust the budget). */
function driveToFallback(hook: { current: ReturnType<typeof useHarness> }) {
  act(() => hook.current.onVideoLoadedData());
  act(() => hook.current.onVideoPlay());
  dropAndRebuild(hook); // drop 1
  dropAndRebuild(hook); // drop 2
  act(() => hook.current.onVideoError()); // drop 3 -> budget spent -> fallback
}

describe("useAvatarPresentation — unified presentation lifecycle", () => {
  it("starts live when a stream URL is provided and advances through buffering/playing", () => {
    const hook = renderHook((props) => useHarness(props), {
      initialProps: live("https://gpu.example.com/live/1"),
    });
    expect(hook.result.current.presentation.stage).toBe("loading");
    expect(hook.result.current.presentation.mode).toBe("live");

    act(() => hook.result.current.onVideoLoadedData());
    expect(hook.result.current.presentation.stage).toBe("buffering");

    act(() => hook.result.current.onVideoPlay());
    expect(hook.result.current.presentation.stage).toBe("playing");
    expect(hook.result.current.avatarFailed).toBe(false);
  });

  it("stays static (fallback) when no stream is provided", () => {
    const hook = renderHook((props) => useHarness(props), {
      initialProps: {},
    });
    expect(hook.result.current.presentation).toEqual(initialPresentationState);
    expect(hook.result.current.presentation.mode).toBe("static");
  });

  it("cleanup resets the presentation to static idle (switch human / conversation)", () => {
    const hook = renderHook((props) => useHarness(props), {
      initialProps: live("https://gpu.example.com/live/1"),
    });
    act(() => hook.result.current.onVideoLoadedData());
    act(() => hook.result.current.onVideoPlay());
    expect(hook.result.current.presentation.stage).toBe("playing");

    act(() => hook.result.current.cleanup());
    expect(hook.result.current.presentation).toEqual(initialPresentationState);
  });

  it("falls back to the static portrait after the stream keeps failing while keeping the answer", () => {
    vi.useFakeTimers();
    const hook = renderHook((props) => useHarness(props), {
      initialProps: live("https://gpu.example.com/live/1"),
    });
    driveToFallback(hook.result);
    // Only the live video degrades to the static portrait; the answer (and any
    // TTS audio) is preserved by the caller.
    expect(hook.result.current.presentation.stage).toBe("fallback");
    expect(hook.result.current.presentation.mode).toBe("static");
    expect(hook.result.current.avatarFailed).toBe(true);
  });

  it("rebuilds a live stream when the page becomes visible again after a fallback", () => {
    vi.useFakeTimers();
    const hook = renderHook((props) => useHarness(props), {
      initialProps: live("https://gpu.example.com/live/1"),
    });
    driveToFallback(hook.result);
    expect(hook.result.current.presentation.mode).toBe("static");

    const nonceBefore = hook.result.current.rebuildNonce;
    Object.defineProperty(document, "hidden", { value: false, configurable: true });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    // A rebuild is requested (media element remounts via a new key).
    expect(hook.result.current.rebuildNonce).toBeGreaterThan(nonceBefore);
  });

  it("rebuilds the stream when the network comes back online after a fallback", () => {
    vi.useFakeTimers();
    const hook = renderHook((props) => useHarness(props), {
      initialProps: live("https://gpu.example.com/live/1"),
    });
    driveToFallback(hook.result);
    expect(hook.result.current.presentation.mode).toBe("static");

    const nonceBefore = hook.result.current.rebuildNonce;
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(hook.result.current.rebuildNonce).toBeGreaterThan(nonceBefore);
  });

  it("forwards AV sync / lip-sync / emotion only when the provider supports them", () => {
    const hook = renderHook((props) => useHarness(props), {
      initialProps: {
        session: session("https://gpu.example.com/live/1"),
        request: { lipSync: true, emotion: true },
        capabilities: {
          audioVideoSync: true,
          lipSync: true,
          emotion: false,
        },
      },
    });
    expect(hook.result.current.params).toEqual({
      syncEnabled: true,
      lipSync: true,
      emotion: false,
    });
  });

  it("forwards no parameters for a capability-less provider", () => {
    const hook = renderHook((props) => useHarness(props), {
      initialProps: {
        session: session("https://gpu.example.com/live/1"),
        request: { lipSync: true, emotion: true },
        capabilities: noPresentationCapabilities,
      },
    });
    expect(hook.result.current.params.lipSync).toBe(false);
    expect(hook.result.current.params.emotion).toBe(false);
    expect(hook.result.current.params.syncEnabled).toBe(false);
  });

  it("derives the static listening pose while natural conversation is active", () => {
    const hook = renderHook((props) => useHarness(props), {
      initialProps: { listening: true },
    });
    expect(hook.result.current.staticPose).toBe("listening");
  });
});