import { describe, expect, it } from "vitest";

import {
  BudgetTracker,
  enforceBudget,
  estimateCost,
  RATE_AUDIO_SEC_CENTS,
  RATE_IMAGE_CENTS,
  RATE_TOKENS_IN_CENTS,
  RATE_TOKENS_OUT_CENTS,
} from "./costBudget";

describe("estimateCost", () => {
  it("computes cost from per-unit rates", () => {
    const estimate = estimateCost({
      provider: "llm",
      tokensIn: 1_000,
      tokensOut: 2_000,
      audioSeconds: 60,
      imageCount: 3,
    });
    const expected =
      1_000 * RATE_TOKENS_IN_CENTS +
      2_000 * RATE_TOKENS_OUT_CENTS +
      60 * RATE_AUDIO_SEC_CENTS +
      3 * RATE_IMAGE_CENTS;
    expect(estimate.cents).toBeCloseTo(expected, 6);
    expect(estimate.currency).toBe("USD");
  });

  it("returns zero for an empty turn", () => {
    const estimate = estimateCost({
      provider: "local",
      tokensIn: 0,
      tokensOut: 0,
      audioSeconds: 0,
      imageCount: 0,
    });
    expect(estimate.cents).toBe(0);
  });
});

describe("BudgetTracker", () => {
  it("tracks remaining budget across spend", () => {
    const tracker = new BudgetTracker(100);
    expect(tracker.remainingCents()).toBe(100);
    tracker.setBudgetCents(50);
    expect(tracker.remainingCents()).toBe(50);
    expect(tracker.spend(30)).toBe(20);
    expect(tracker.remainingCents()).toBe(20);
  });

  it("wouldExceed flags spending past the remaining budget", () => {
    const tracker = new BudgetTracker(10);
    expect(tracker.wouldExceed(10)).toBe(false);
    expect(tracker.wouldExceed(11)).toBe(true);
    tracker.spend(4);
    expect(tracker.wouldExceed(6)).toBe(false);
    expect(tracker.wouldExceed(7)).toBe(true);
  });

  it("enforceBudget blocks when estimate exceeds remaining", () => {
    const tracker = new BudgetTracker(5);
    const estimate = estimateCost({
      provider: "llm",
      tokensIn: 0,
      tokensOut: 0,
      audioSeconds: 0,
      imageCount: 10,
    });
    const result = enforceBudget(tracker, estimate);
    expect(result.allowed).toBe(false);
    expect(result.remainingCents).toBe(5);
    // No money was spent on a blocked turn.
    expect(tracker.remainingCents()).toBe(5);
  });

  it("enforceBudget spends when the estimate fits", () => {
    const tracker = new BudgetTracker(100);
    const estimate = { cents: 20, currency: "USD" as const };
    const result = enforceBudget(tracker, estimate);
    expect(result.allowed).toBe(true);
    expect(result.remainingCents).toBe(80);
    expect(tracker.remainingCents()).toBe(80);
  });
});