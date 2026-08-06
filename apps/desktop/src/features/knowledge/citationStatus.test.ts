import { describe, expect, it } from "vitest";

import {
  classifyCitationStatus,
  conflictLevel,
  type CitationMeta,
} from "./citationStatus";

const NOW = 5_000_000;

describe("classifyCitationStatus", () => {
  it("marks deleted when the referenced document no longer exists", () => {
    expect(
      classifyCitationStatus({
        sourceSyncedAtMs: NOW,
        sourceUpdatedAtMs: null,
        nowMs: NOW,
        staleAfterMs: 1000,
        referencedDocExists: false,
      }),
    ).toBe("deleted");
  });

  it("returns unknown without a sync timestamp", () => {
    expect(
      classifyCitationStatus({
        sourceSyncedAtMs: null,
        sourceUpdatedAtMs: null,
        nowMs: NOW,
        staleAfterMs: 1000,
        referencedDocExists: true,
      }),
    ).toBe("unknown");
  });

  it("marks stale when the source changed after the last sync", () => {
    expect(
      classifyCitationStatus({
        sourceSyncedAtMs: NOW - 500,
        sourceUpdatedAtMs: NOW - 100,
        nowMs: NOW,
        staleAfterMs: 10_000,
        referencedDocExists: true,
      }),
    ).toBe("stale");
  });

  it("marks stale when the sync is older than staleAfterMs", () => {
    expect(
      classifyCitationStatus({
        sourceSyncedAtMs: NOW - 2000,
        sourceUpdatedAtMs: null,
        nowMs: NOW,
        staleAfterMs: 1000,
        referencedDocExists: true,
      }),
    ).toBe("stale");
  });

  it("marks fresh when recently synced with no pending change", () => {
    expect(
      classifyCitationStatus({
        sourceSyncedAtMs: NOW - 500,
        sourceUpdatedAtMs: null,
        nowMs: NOW,
        staleAfterMs: 1000,
        referencedDocExists: true,
      }),
    ).toBe("fresh");
  });
});

describe("conflictLevel", () => {
  const meta = (id: string, sourceId: string): CitationMeta => ({
    id,
    sourceId,
    textPreview: "text",
    passageLocator: "p1",
    updatedAtMs: NOW,
    syncState: "fresh",
  });

  it("returns none for empty citations", () => {
    expect(conflictLevel([])).toBe("none");
  });

  it("returns none when all citations come from a single source", () => {
    expect(conflictLevel([meta("a", "src1"), meta("b", "src1")])).toBe("none");
  });

  it("returns minor when multiple sources exist but one dominates", () => {
    expect(
      conflictLevel([meta("a", "src1"), meta("b", "src1"), meta("c", "src2")]),
    ).toBe("minor");
  });

  it("returns conflict when multiple sources disagree with comparable weight", () => {
    expect(
      conflictLevel([meta("a", "src1"), meta("b", "src1"), meta("c", "src2"), meta("d", "src2")]),
    ).toBe("conflict");
  });
});