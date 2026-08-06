import { afterEach, describe, expect, it, vi } from "vitest";

import { createFirstFrameTimeout } from "./firstFrameTimeout";

afterEach(() => {
  vi.useRealTimers();
});

describe("createFirstFrameTimeout", () => {
  it("times out if the stream never becomes ready", () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const guard = createFirstFrameTimeout({ timeoutMs: 3000, onTimeout });
    guard.noteState("loading");
    vi.advanceTimersByTime(3000);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it("cancels the timeout when the stream becomes ready in time", () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const guard = createFirstFrameTimeout({ timeoutMs: 3000, onTimeout });
    guard.noteState("loading");
    guard.noteState("ready");
    vi.advanceTimersByTime(10_000);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("re-arms the timeout after returning to loading", () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const guard = createFirstFrameTimeout({ timeoutMs: 3000, onTimeout });
    guard.noteState("loading");
    guard.noteState("ready");
    guard.noteState("loading"); // a later rebuild re-arms
    vi.advanceTimersByTime(3000);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it("cancel() prevents the timeout from firing", () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const guard = createFirstFrameTimeout({ timeoutMs: 3000, onTimeout });
    guard.noteState("loading");
    guard.cancel();
    vi.advanceTimersByTime(10_000);
    expect(onTimeout).not.toHaveBeenCalled();
  });
});