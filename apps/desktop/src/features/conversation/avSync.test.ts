import { describe, expect, it } from "vitest";

import {
  AvSyncTracker,
  computeAvSyncErrorMs,
} from "./avSync";

describe("computeAvSyncErrorMs", () => {
  it("reports the absolute error and in-tolerance within the window", () => {
    expect(computeAvSyncErrorMs(1000, 1050, 100)).toEqual({
      errorMs: 50,
      withinTolerance: true,
    });
    // Negative / positive drift collapse to the same absolute magnitude.
    expect(computeAvSyncErrorMs(1050, 1000, 100)).toEqual({
      errorMs: 50,
      withinTolerance: true,
    });
  });

  it("reports out-of-tolerance when the drift exceeds the window", () => {
    expect(computeAvSyncErrorMs(1000, 1200, 100)).toEqual({
      errorMs: 200,
      withinTolerance: false,
    });
  });

  it("treats an exactly-at-tolerance drift as in-tolerance", () => {
    expect(computeAvSyncErrorMs(1000, 1100, 100)).toEqual({
      errorMs: 100,
      withinTolerance: true,
    });
  });
});

describe("AvSyncTracker", () => {
  it("returns null p95 before any sample is recorded", () => {
    const tracker = new AvSyncTracker();
    expect(tracker.count()).toBe(0);
    expect(tracker.p95()).toBeNull();
  });

  it("reports the p95 error over recorded samples", () => {
    const tracker = new AvSyncTracker();
    // 19 samples below 100, 1 sample at 1000 -> p95 should pick a low value.
    for (let i = 0; i < 19; i++) {
      tracker.record(0, i * 5);
    }
    tracker.record(0, 1000);
    // 20 samples: p95 rank = ceil(20*0.95)-1 = 18 (0-indexed).
    expect(tracker.p95()).toBe(90);
    expect(tracker.count()).toBe(20);
  });

  it("is bounded and does not grow memory without limit", () => {
    const tracker = new AvSyncTracker(5);
    for (let i = 0; i < 20; i++) {
      tracker.record(0, i);
    }
    expect(tracker.count()).toBe(5);
  });

  it("clear() drops all samples", () => {
    const tracker = new AvSyncTracker();
    tracker.record(0, 10);
    tracker.record(0, 20);
    tracker.clear();
    expect(tracker.count()).toBe(0);
    expect(tracker.p95()).toBeNull();
  });
});