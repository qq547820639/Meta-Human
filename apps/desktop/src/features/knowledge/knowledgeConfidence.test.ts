import { describe, expect, it } from "vitest";

import {
  evaluateAnswerConfidence,
  shouldSayDontKnow,
} from "./knowledgeConfidence";

describe("evaluateAnswerConfidence", () => {
  it("returns unknown without a reliable source", () => {
    expect(
      evaluateAnswerConfidence({
        hasReliableSource: false,
        sourceScore: 0.9,
        minScore: 0.5,
        hasConflict: false,
      }),
    ).toBe("unknown");
  });

  it("returns limited when sources conflict", () => {
    expect(
      evaluateAnswerConfidence({
        hasReliableSource: true,
        sourceScore: 0.9,
        minScore: 0.5,
        hasConflict: true,
      }),
    ).toBe("limited");
  });

  it("returns limited when the score is unavailable", () => {
    expect(
      evaluateAnswerConfidence({
        hasReliableSource: true,
        sourceScore: null,
        minScore: 0.5,
        hasConflict: false,
      }),
    ).toBe("limited");
  });

  it("returns unknown when the score is below the minimum", () => {
    expect(
      evaluateAnswerConfidence({
        hasReliableSource: true,
        sourceScore: 0.3,
        minScore: 0.5,
        hasConflict: false,
      }),
    ).toBe("unknown");
  });

  it("returns confident when grounded with a sufficient score", () => {
    expect(
      evaluateAnswerConfidence({
        hasReliableSource: true,
        sourceScore: 0.9,
        minScore: 0.5,
        hasConflict: false,
      }),
    ).toBe("confident");
  });
});

describe("shouldSayDontKnow", () => {
  it("says I don't know only for unknown", () => {
    expect(shouldSayDontKnow("unknown")).toBe(true);
    expect(shouldSayDontKnow("limited")).toBe(false);
    expect(shouldSayDontKnow("confident")).toBe(false);
  });
});