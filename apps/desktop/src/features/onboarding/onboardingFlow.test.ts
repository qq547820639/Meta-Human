import { describe, expect, it } from "vitest";

import {
  ONBOARDING_STEPS,
  estimateRemaining,
  nextStep,
  resumeStep,
  stepForIndex,
  totalSteps,
} from "./onboardingFlow";

describe("onboardingFlow", () => {
  it("defines exactly 5 steps in the expected order", () => {
    expect(totalSteps()).toBe(5);
    expect(ONBOARDING_STEPS.map((step) => step.id)).toEqual([
      "prepare-environment",
      "create-avatar",
      "create-voice",
      "first-answer",
      "save-memory",
    ]);
  });

  it("returns the step for a valid index and null out of range", () => {
    expect(stepForIndex(0)?.id).toBe("prepare-environment");
    expect(stepForIndex(4)?.id).toBe("save-memory");
    expect(stepForIndex(-1)).toBeNull();
    expect(stepForIndex(5)).toBeNull();
  });

  it("gives every step exactly one primary decision", () => {
    for (const step of ONBOARDING_STEPS) {
      expect(step.primaryDecision.trim().length).toBeGreaterThan(0);
    }
  });

  it("walks forward through the flow and stops at the end", () => {
    expect(nextStep("prepare-environment")).toBe("create-avatar");
    expect(nextStep("create-avatar")).toBe("create-voice");
    expect(nextStep("create-voice")).toBe("first-answer");
    expect(nextStep("first-answer")).toBe("save-memory");
    expect(nextStep("save-memory")).toBeNull();
  });

  it("returns null for an unknown current step", () => {
    expect(nextStep("no-such-step" as never)).toBeNull();
  });

  it("estimates remaining seconds monotonically", () => {
    const perStepMs = 60_000;
    let previous = estimateRemaining(0, perStepMs);
    for (let i = 1; i <= 5; i += 1) {
      const current = estimateRemaining(i, perStepMs);
      expect(current).toBeLessThanOrEqual(previous);
      previous = current;
    }
  });

  it("estimates zero remaining at the end of the flow", () => {
    expect(estimateRemaining(5, 60_000)).toBe(0);
  });

  it("bounds estimates for out-of-range indexes", () => {
    expect(estimateRemaining(-3, 60_000)).toBe(300);
    expect(estimateRemaining(99, 60_000)).toBe(0);
  });

  it("resumes at the next incomplete step", () => {
    expect(resumeStep(-1)).toBe(0);
    expect(resumeStep(0)).toBe(1);
    expect(resumeStep(2)).toBe(3);
    expect(resumeStep(4)).toBeNull();
  });
});