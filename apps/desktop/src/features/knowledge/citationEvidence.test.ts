import { describe, expect, it } from "vitest";

import {
  assertEvidenceFields,
  shouldRevealRetrievalEvidence,
} from "./citationEvidence";

describe("shouldRevealRetrievalEvidence", () => {
  it("reveals evidence only in advanced mode with a score requested", () => {
    expect(shouldRevealRetrievalEvidence({ advancedMode: true, includeScore: true })).toBe(true);
  });

  it("hides evidence in non-advanced mode", () => {
    expect(shouldRevealRetrievalEvidence({ advancedMode: false, includeScore: true })).toBe(false);
  });

  it("hides evidence when no score is requested", () => {
    expect(shouldRevealRetrievalEvidence({ advancedMode: true, includeScore: false })).toBe(false);
  });

  it("hides evidence when both are off", () => {
    expect(shouldRevealRetrievalEvidence({ advancedMode: false, includeScore: false })).toBe(false);
  });
});

describe("assertEvidenceFields", () => {
  const valid = {
    id: "c1",
    sourceId: "src1",
    textPreview: "t",
    passageLocator: "p1",
    updatedAtMs: 100,
    syncState: "fresh" as const,
  };

  it("returns no missing fields for a complete citation", () => {
    expect(assertEvidenceFields(valid)).toEqual([]);
  });

  it("flags each missing required field", () => {
    const missing = assertEvidenceFields({ sourceId: "src1" });
    expect(missing).toEqual(
      expect.arrayContaining(["id", "textPreview", "passageLocator", "updatedAtMs", "syncState"]),
    );
  });

  it("flags a null updatedAtMs as invalid", () => {
    const missing = assertEvidenceFields({ ...valid, updatedAtMs: null });
    expect(missing).toContain("updatedAtMs");
  });

  it("flags an empty syncState as invalid", () => {
    const missing = assertEvidenceFields({ ...valid, syncState: undefined });
    expect(missing).toContain("syncState");
  });
});