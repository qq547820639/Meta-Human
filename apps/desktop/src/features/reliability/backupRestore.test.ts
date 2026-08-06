import { describe, expect, it } from "vitest";

import {
  createBackupManager,
  createMigrationState,
  shouldAllowDowngrade,
  versionCompare,
} from "./backupRestore";

describe("versionCompare", () => {
  it("orders versions numerically", () => {
    expect(versionCompare("1.0.0", "2.0.0")).toBe(-1);
    expect(versionCompare("2.0.0", "1.0.0")).toBe(1);
    expect(versionCompare("1.2.0", "1.10.0")).toBe(-1);
    expect(versionCompare("1.2.0", "1.2.0")).toBe(0);
  });

  it("treats missing segments as zero", () => {
    expect(versionCompare("1.2", "1.2.0")).toBe(0);
    expect(versionCompare("1", "1.0.1")).toBe(-1);
  });
});

describe("shouldAllowDowngrade", () => {
  it("blocks downgrades", () => {
    expect(shouldAllowDowngrade("1.0.0", "2.0.0")).toBe(false);
  });

  it("allows same or newer versions", () => {
    expect(shouldAllowDowngrade("2.0.0", "2.0.0")).toBe(true);
    expect(shouldAllowDowngrade("2.1.0", "2.0.0")).toBe(true);
  });
});

describe("createMigrationState", () => {
  it("starts healthy and marks a migration in progress as unhealthy", () => {
    const state = createMigrationState({ version: "1.0.0", data: { n: 1 } });
    expect(state.isHealthy()).toBe(true);

    state.markMigrated({ version: "1.1.0", data: { n: 2 } });
    expect(state.isHealthy()).toBe(false); // migration not yet confirmed
  });

  it("recovers to the last healthy snapshot on failure", () => {
    const state = createMigrationState({ version: "1.0.0", data: { n: 1 } });

    // Apply 1.1.0 then start 1.2.0 (in progress).
    state.markMigrated({ version: "1.1.0", data: { n: 2 } });
    state.markMigrated({ version: "1.2.0", data: { n: 3 } });

    const recovered = state.recoverFromMigrationFailure();
    expect(recovered.version).toBe("1.1.0"); // last confirmed healthy snapshot
    expect(state.isHealthy()).toBe(true);
  });
});

describe("createBackupManager", () => {
  it("creates, lists and restores backups", () => {
    let clock = 0;
    const manager = createBackupManager<number>(() => {
      clock += 1;
      return clock;
    });

    const id = manager.createBackup(1);
    manager.createBackup(2);

    expect(manager.list().map((e) => e.snapshot)).toEqual([1, 2]);
    expect(manager.restore(id)).toBe(1);
    expect(manager.getCurrent()).toBe(1);
  });

  it("restoreBeforeRestore backs up the current state, and null before any", () => {
    const manager = createBackupManager<number>();
    expect(manager.restoreBeforeRestore()).toBeNull();

    manager.createBackup(5);
    manager.restore("backup-1");
    const undoId = manager.restoreBeforeRestore();
    expect(undoId).toBe("backup-2");
    expect(manager.list()).toHaveLength(2);
  });

  it("a failed restore leaves the current data intact", () => {
    const manager = createBackupManager<number>();
    manager.createBackup(42);
    manager.restore("backup-1");
    expect(manager.getCurrent()).toBe(42);

    expect(() => manager.restore("does-not-exist")).toThrow();
    expect(manager.getCurrent()).toBe(42); // unchanged
  });
});