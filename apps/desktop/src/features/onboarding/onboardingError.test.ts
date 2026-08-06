import { describe, expect, it } from "vitest";

import {
  classifyFailure,
  needsOneClickFix,
  type FailureKind,
} from "./onboardingError";

const KNOWN_KINDS: FailureKind[] = [
  "port-in-use",
  "model-not-running",
  "bad-credentials",
  "permission-denied-mic",
  "permission-denied-camera",
  "disk-low",
  "no-network",
];

describe("onboardingError", () => {
  it("returns all four fields, a level and a kind for every known kind", () => {
    for (const kind of KNOWN_KINDS) {
      const guidance = classifyFailure(kind);
      expect(guidance.kind).toBe(kind);
      expect(guidance.detection.trim().length).toBeGreaterThan(0);
      expect(guidance.reason.trim().length).toBeGreaterThan(0);
      expect(guidance.impact.trim().length).toBeGreaterThan(0);
      expect(guidance.oneClickFix.trim().length).toBeGreaterThan(0);
      expect(["error", "warning"]).toContain(guidance.level);
    }
  });

  it("falls back to the unknown kind for unrecognized input", () => {
    const guidance = classifyFailure("some-mystery" as FailureKind);
    expect(guidance.kind).toBe("unknown");
    expect(guidance.detection.trim().length).toBeGreaterThan(0);
    expect(guidance.reason.trim().length).toBeGreaterThan(0);
    expect(guidance.impact.trim().length).toBeGreaterThan(0);
    expect(guidance.level).toBe("warning");
  });

  it("reports a fix is available for every known kind", () => {
    for (const kind of KNOWN_KINDS) {
      expect(needsOneClickFix(classifyFailure(kind))).toBe(true);
    }
  });

  it("reports no fix for the unknown fallback", () => {
    const guidance = classifyFailure("some-mystery" as FailureKind);
    expect(needsOneClickFix(guidance)).toBe(false);
    expect(guidance.oneClickFix).toBe("");
  });

  it("classifies permission issues as warnings", () => {
    expect(classifyFailure("permission-denied-mic").level).toBe("warning");
    expect(classifyFailure("permission-denied-camera").level).toBe("warning");
    expect(classifyFailure("disk-low").level).toBe("warning");
  });
});