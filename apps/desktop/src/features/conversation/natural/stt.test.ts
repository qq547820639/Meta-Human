import { afterEach, describe, expect, it, vi } from "vitest";

import { createSidecarSttSession, SttError } from "./stt";

function makeCapture() {
  return {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue("tmp/recording.wav"),
    cleanup: vi.fn().mockResolvedValue(undefined),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("createSidecarSttSession", () => {
  it("records then transcribes, resolving with the trimmed final text", async () => {
    const capture = makeCapture();
    const transcribe = vi.fn().mockResolvedValue("  你好，世界。  ");
    const session = createSidecarSttSession({}, { capture, transcribe });

    session.start();
    const result = await session.stop();

    expect(transcribe).toHaveBeenCalledWith("tmp/recording.wav");
    expect(result).toBe("你好，世界。");
    expect(capture.cleanup).toHaveBeenCalledWith("tmp/recording.wav");
    expect(session.supportsInterim).toBe(false);
  });

  it("rejects with reason empty-transcript when the transcript is blank", async () => {
    const capture = makeCapture();
    const transcribe = vi.fn().mockResolvedValue("   ");
    const session = createSidecarSttSession({}, { capture, transcribe });

    session.start();
    await expect(session.stop()).rejects.toMatchObject({
      name: "SttError",
      reason: "empty-transcript",
    });
  });

  it("rejects with reason timeout when the sidecar never answers", async () => {
    vi.useFakeTimers();
    const capture = makeCapture();
    const transcribe = vi.fn(() => new Promise<string>(() => {}));
    const session = createSidecarSttSession(
      {},
      { capture, transcribe, timeoutMs: 100 },
    );

    session.start();
    const pending = session.stop();
    // Attach the rejection handler synchronously so the timeout rejection is
    // consumed before the fake-clock tick that produces it (avoids an
    // unhandled-rejection race under vitest fake timers).
    const assertion = expect(pending).rejects.toMatchObject({
      reason: "timeout",
    });
    // `runStop` awaits capture.stop() (a microtask) before registering the
    // timeout timer, so advance the clock asynchronously to flush it first.
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
  });

  it("rejects with reason aborted when the user cancels mid-transcribe", async () => {
    const capture = makeCapture();
    const transcribe = vi.fn(() => new Promise<string>(() => {}));
    const session = createSidecarSttSession({}, { capture, transcribe });

    session.start();
    const pending = session.stop();
    session.abort();
    await expect(pending).rejects.toMatchObject({ reason: "aborted" });
  });

  it("rejects with reason aborted when stop() is called after abort()", async () => {
    const capture = makeCapture();
    const session = createSidecarSttSession({}, { capture, transcribe: vi.fn() });
    session.start();
    session.abort();
    await expect(session.stop()).rejects.toMatchObject({ reason: "aborted" });
  });

  it("maps a mic permission denial to reason permission-denied", async () => {
    // Real browsers reject capture with a DOMException whose `name` is
    // "NotAllowedError"; mirror that contract so the mapper hits the right branch.
    const denied = new Error("mic permission denied");
    denied.name = "NotAllowedError";
    const capture = {
      start: vi.fn().mockRejectedValue(denied),
      stop: vi.fn(),
      cleanup: vi.fn(),
    };
    const session = createSidecarSttSession({}, { capture, transcribe: vi.fn() });
    session.start();
    // Let the async capture.start() rejection populate startError.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(session.stop()).rejects.toMatchObject({
      reason: "permission-denied",
    });
  });

  it("propagates a sidecar transport error as reason sidecar-unreachable", async () => {
    const capture = makeCapture();
    const transcribe = vi.fn().mockRejectedValue(
      new SttError("sidecar-unreachable", "can't reach the sidecar"),
    );
    const session = createSidecarSttSession({}, { capture, transcribe });
    session.start();
    await expect(session.stop()).rejects.toMatchObject({
      reason: "sidecar-unreachable",
    });
  });

  it("rejects stop() when the session was never started", async () => {
    const session = createSidecarSttSession({}, { transcribe: vi.fn() });
    await expect(session.stop()).rejects.toMatchObject({ reason: "aborted" });
  });
});