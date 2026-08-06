import { describe, expect, it } from "vitest";

import { computeSourceSync, sourceNeedsRebuild } from "./sourceSyncStatus";

const NOW = 5_000_000;

describe("computeSourceSync", () => {
  it("returns failed when the last sync failed", () => {
    expect(
      computeSourceSync({
        lastSyncAtMs: NOW,
        lastChangeAtMs: null,
        nowMs: NOW,
        pendingChanges: false,
        failed: true,
      }),
    ).toBe("failed");
  });

  it("returns syncing when changes are pending", () => {
    expect(
      computeSourceSync({
        lastSyncAtMs: NOW,
        lastChangeAtMs: null,
        nowMs: NOW,
        pendingChanges: true,
        failed: false,
      }),
    ).toBe("syncing");
  });

  it("returns outdated when never synced", () => {
    expect(
      computeSourceSync({
        lastSyncAtMs: null,
        lastChangeAtMs: null,
        nowMs: NOW,
        pendingChanges: false,
        failed: false,
      }),
    ).toBe("outdated");
  });

  it("returns outdated when the source changed after the last sync", () => {
    expect(
      computeSourceSync({
        lastSyncAtMs: NOW - 100,
        lastChangeAtMs: NOW - 10,
        nowMs: NOW,
        pendingChanges: false,
        failed: false,
      }),
    ).toBe("outdated");
  });

  it("returns synced when current", () => {
    expect(
      computeSourceSync({
        lastSyncAtMs: NOW - 100,
        lastChangeAtMs: NOW - 200,
        nowMs: NOW,
        pendingChanges: false,
        failed: false,
      }),
    ).toBe("synced");
  });
});

describe("sourceNeedsRebuild", () => {
  it("needs rebuild when never synced", () => {
    expect(
      sourceNeedsRebuild({ lastSyncAtMs: null, lastChangeAtMs: null, nowMs: NOW, maxAgeMs: 1000 }),
    ).toBe(true);
  });

  it("needs rebuild when the source changed after the last sync", () => {
    expect(
      sourceNeedsRebuild({ lastSyncAtMs: NOW - 100, lastChangeAtMs: NOW - 10, nowMs: NOW, maxAgeMs: 1000 }),
    ).toBe(true);
  });

  it("needs rebuild when the sync is older than maxAgeMs", () => {
    expect(
      sourceNeedsRebuild({ lastSyncAtMs: NOW - 2000, lastChangeAtMs: null, nowMs: NOW, maxAgeMs: 1000 }),
    ).toBe(true);
  });

  it("does not need rebuild when current", () => {
    expect(
      sourceNeedsRebuild({ lastSyncAtMs: NOW - 100, lastChangeAtMs: null, nowMs: NOW, maxAgeMs: 1000 }),
    ).toBe(false);
  });
});