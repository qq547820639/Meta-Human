import { describe, expect, it } from "vitest";

import { recordStage, stageLatency, type StageRecord } from "./stageMetrics";

const record = (
  stage: StageRecord["stage"],
  startedAtMs: number,
  finishedAtMs: number,
  ok: boolean,
): StageRecord => ({ stage, startedAtMs, finishedAtMs, ok });

describe("recordStage", () => {
  it("appends immutably", () => {
    const a = [record("stt", 0, 10, true)];
    const b = recordStage(a, record("llm", 10, 30, true));
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(2);
  });
});

describe("stageLatency", () => {
  it("aggregates latency per stage and counts failures", () => {
    const stages = [
      record("stt", 0, 10, true), // 10
      record("stt", 10, 40, true), // 30
      record("stt", 40, 45, false), // 5, failure
      record("llm", 0, 20, true), // different stage
    ];
    const stt = stageLatency(stages, "stt");
    expect(stt.count).toBe(3);
    expect(stt.failures).toBe(1);
    expect(stt.avgMs).toBe(15); // (10 + 30 + 5) / 3
    expect(stt.p95Ms).toBe(30); // nearest-rank over [5,10,30]
  });

  it("computes p95 over a larger batch", () => {
    // latencies: 100, 200, ..., 1000 (10 samples)
    const stages = Array.from({ length: 10 }, (_, i) =>
      record("tts", i * 100, i * 100 + 100 * (i + 1), true),
    );
    const tts = stageLatency(stages, "tts");
    expect(tts.count).toBe(10);
    expect(tts.failures).toBe(0);
    expect(tts.avgMs).toBe(550);
    expect(tts.p95Ms).toBe(1000);
  });

  it("returns null latencies for a stage with no records", () => {
    const empty = stageLatency([], "avatar");
    expect(empty.count).toBe(0);
    expect(empty.failures).toBe(0);
    expect(empty.avgMs).toBeNull();
    expect(empty.p95Ms).toBeNull();
  });
});