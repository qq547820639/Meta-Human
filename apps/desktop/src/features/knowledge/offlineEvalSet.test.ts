import { describe, expect, it } from "vitest";

import { OFFLINE_EVAL_SET, runEvalSet, type EvalCase } from "./offlineEvalSet";

describe("OFFLINE_EVAL_SET", () => {
  it("is non-empty", () => {
    expect(OFFLINE_EVAL_SET.length).toBeGreaterThan(0);
  });

  it("covers all five categories", () => {
    const categories = new Set(OFFLINE_EVAL_SET.map((c) => c.category));
    expect(categories).toEqual(
      new Set([
        "accuracy",
        "conflict",
        "stale",
        "privacy-leak",
        "cross-session-contamination",
      ]),
    );
  });

  it("has stable unique ids", () => {
    const ids = new Set(OFFLINE_EVAL_SET.map((c) => c.id));
    expect(ids.size).toBe(OFFLINE_EVAL_SET.length);
  });
});

describe("runEvalSet", () => {
  const judgePassingAccuracyOnly = (testCase: EvalCase): boolean =>
    testCase.category === "accuracy";

  it("counts passes and flags the failing case ids", () => {
    const result = runEvalSet(OFFLINE_EVAL_SET, judgePassingAccuracyOnly);
    expect(result.pass).toBe(1);
    expect(result.fail).toBe(OFFLINE_EVAL_SET.length - 1);
    expect(result.failingIds).toEqual(
      expect.arrayContaining(["conflict-1", "stale-1", "privacy-1", "x-session-1"]),
    );
  });

  it("a judge that fails privacy-leak yields the correct counts", () => {
    const judge = (testCase: EvalCase): boolean => testCase.category !== "privacy-leak";
    const result = runEvalSet(OFFLINE_EVAL_SET, judge);
    expect(result.pass).toBe(OFFLINE_EVAL_SET.length - 1);
    expect(result.fail).toBe(1);
    expect(result.failingIds).toEqual(["privacy-1"]);
  });

  it("passes everything with an always-true judge", () => {
    const result = runEvalSet(OFFLINE_EVAL_SET, () => true);
    expect(result.pass).toBe(OFFLINE_EVAL_SET.length);
    expect(result.fail).toBe(0);
    expect(result.failingIds).toEqual([]);
  });
});