import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createFrameDropDetector,
  createStallDetector,
} from "./stallDetector";

afterEach(() => {
  vi.useRealTimers();
});

describe("createStallDetector", () => {
  it("does not fire while progress is being made", () => {
    vi.useFakeTimers();
    const onStall = vi.fn();
    const detector = createStallDetector(
      { stallThresholdMs: 1000, sampleIntervalMs: 100 },
      onStall,
    );
    detector.onProgress(Date.now(), 0);
    detector.onProgress(Date.now(), 1); // advanced
    vi.advanceTimersByTime(500);
    expect(onStall).not.toHaveBeenCalled();
  });

  it("fires after the video time freezes for the threshold", () => {
    vi.useFakeTimers();
    const onStall = vi.fn();
    const detector = createStallDetector(
      { stallThresholdMs: 1000, sampleIntervalMs: 100 },
      onStall,
    );
    detector.onProgress(Date.now(), 0);
    detector.onProgress(Date.now(), 0); // frozen: same video time
    vi.advanceTimersByTime(1000);
    expect(onStall).toHaveBeenCalledTimes(1);
  });

  it("resets the stall once progress resumes, then fires again", () => {
    vi.useFakeTimers();
    const onStall = vi.fn();
    const detector = createStallDetector(
      { stallThresholdMs: 1000, sampleIntervalMs: 100 },
      onStall,
    );
    detector.onProgress(Date.now(), 0);
    vi.advanceTimersByTime(1000);
    expect(onStall).toHaveBeenCalledTimes(1);

    detector.onProgress(Date.now(), 5); // progress resumes
    vi.advanceTimersByTime(500);
    expect(onStall).toHaveBeenCalledTimes(1); // no new stall

    vi.advanceTimersByTime(500); // frozen again past threshold
    expect(onStall).toHaveBeenCalledTimes(2);
  });

  it("cancel() stops further stall reports", () => {
    vi.useFakeTimers();
    const onStall = vi.fn();
    const detector = createStallDetector(
      { stallThresholdMs: 1000, sampleIntervalMs: 100 },
      onStall,
    );
    detector.onProgress(Date.now(), 0);
    detector.cancel();
    vi.advanceTimersByTime(5000);
    expect(onStall).not.toHaveBeenCalled();
  });
});

describe("createFrameDropDetector", () => {
  it("does not report a drop for the first frame", () => {
    const detector = createFrameDropDetector({ maxGapMs: 100 });
    expect(detector.record(0)).toBe(false);
  });

  it("reports a drop when the gap between consecutive frames exceeds maxGapMs", () => {
    const detector = createFrameDropDetector({ maxGapMs: 100 });
    expect(detector.record(0)).toBe(false);
    expect(detector.record(50)).toBe(false); // within gap
    expect(detector.record(200)).toBe(true); // gap 150 > 100
    expect(detector.record(250)).toBe(false); // gap 50 within
  });

  it("does not report a drop when gaps stay within the max", () => {
    const detector = createFrameDropDetector({ maxGapMs: 100 });
    for (const t of [0, 33, 66, 99, 132]) {
      expect(detector.record(t)).toBe(false);
    }
  });
});