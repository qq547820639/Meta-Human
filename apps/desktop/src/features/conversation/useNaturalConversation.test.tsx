import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createMockSttSession } from "./natural/stt";
import {
  VadStartError,
  type VadAdapter,
  type VadStartErrorReason,
} from "./natural/vadAdapter";
import { useNaturalConversation } from "./useNaturalConversation";

afterEach(() => {
  vi.restoreAllMocks();
});

function throwingVad(reason: VadStartErrorReason): VadAdapter {
  return {
    name: "throwing-vad",
    get active() {
      return false;
    },
    start: () =>
      Promise.reject(
        new VadStartError(reason, "麦克风权限被拒绝，无法进入自然对话。"),
      ),
    stop: () => Promise.resolve(),
    dispose: () => Promise.resolve(),
  };
}

function baseProps(overrides: Partial<Parameters<typeof useNaturalConversation>[0]> = {}) {
  return {
    getConversationId: () => null,
    setMessages: vi.fn(),
    setQuery: vi.fn(),
    setError: vi.fn(),
    onMetrics: vi.fn(),
    dispatch: vi.fn(),
    sttFactory: (callbacks: Parameters<typeof createMockSttSession>[0]) =>
      createMockSttSession(callbacks),
    ...overrides,
  };
}

/** Stub navigator.mediaDevices.getUserMedia to resolve a real-ish stream. */
function stubGetUserMedia() {
  const track = {
    getSettings: () => ({ echoCancellation: true }),
    getCapabilities: () => ({ echoCancellation: true }),
    stop: vi.fn(),
  };
  const stream = {
    getAudioTracks: () => [track],
    getTracks: () => [track],
  } as unknown as MediaStream;
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    configurable: true,
  });
}

describe("useNaturalConversation — first-use & permission UX", () => {
  it("recommends text_only when the platform has no microphone capability", async () => {
    // jsdom has no navigator.mediaDevices by default -> getUserMedia false.
    const { result } = renderHook(() =>
      useNaturalConversation(baseProps()),
    );
    await waitFor(() =>
      expect(result.current.micCapabilities.getUserMedia).toBe(false),
    );
    expect(result.current.recommendedMode).toBe("text_only");
  });

  it("recommends natural when microphone + STT are both available", async () => {
    stubGetUserMedia();
    const { result } = renderHook(() =>
      useNaturalConversation(baseProps()),
    );
    await waitFor(() =>
      expect(result.current.micCapabilities.getUserMedia).toBe(true),
    );
    expect(result.current.recommendedMode).toBe("natural");
  });

  it("surfaces micDenied when the VAD start is rejected with permission-denied", async () => {
    const { result } = renderHook(() =>
      useNaturalConversation(
        baseProps({ vadFactory: () => throwingVad("permission-denied") }),
      ),
    );
    await act(async () => {
      await result.current.enableNatural("natural");
    });
    expect(result.current.micDenied).toBe(true);
    expect(result.current.micDeniedReason).toBe(
      "麦克风权限被拒绝，无法进入自然对话。",
    );
    // The machine must not sit in "listening" without an open mic.
    expect(result.current.naturalActive).toBe(false);
  });

  it("keeps text_only out of the mic pipeline (no VAD start)", async () => {
    const vad = throwingVad("permission-denied");
    const vadStart = vi.spyOn(vad, "start");
    const { result } = renderHook(() =>
      useNaturalConversation(baseProps({ vadFactory: () => vad })),
    );
    await act(async () => {
      await result.current.enableNatural("text_only");
    });
    expect(vadStart).not.toHaveBeenCalled();
    expect(result.current.micDenied).toBe(false);
  });
});