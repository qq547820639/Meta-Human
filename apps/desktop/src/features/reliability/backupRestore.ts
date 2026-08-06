/**
 * Update rollback + DB migration failure recovery + backup management.
 *
 * - `versionCompare` / `shouldAllowDowngrade`: semver-ish ordering; downgrades
 *   are blocked.
 * - `MigrationState`: tracks the running vs. last-known-healthy schema so a
 *   failed migration can roll back to the last healthy snapshot.
 * - `createBackupManager`: an in-memory snapshot store where every restore is
 *   atomic (existing data is only swapped on success) and `restoreBeforeRestore`
 *   always captures the current state first so a restore can be undone.
 *
 * Pure and testable — the backup manager keeps snapshots in a Map and takes an
 * injectable clock; no disk, DB or network.
 */

/** Compare two dotted versions ("1.2.3") numerically. -1 / 0 / 1. */
export function versionCompare(a: string, b: string): number {
  const partA = parseParts(a);
  const partB = parseParts(b);
  const len = Math.max(partA.length, partB.length);
  for (let i = 0; i < len; i += 1) {
    const na = i < partA.length ? partA[i] : 0;
    const nb = i < partB.length ? partB[i] : 0;
    if (na < nb) {
      return -1;
    }
    if (na > nb) {
      return 1;
    }
  }
  return 0;
}

function parseParts(version: string): number[] {
  return version
    .split(".")
    .map((part) => {
      const value = Number.parseInt(part, 10);
      return Number.isNaN(value) ? 0 : value;
    });
}

/**
 * Whether restoring data of `fromVersion` over `currentVersion` is permitted.
 * Downgrades (fromVersion older than currentVersion) are blocked -> false.
 */
export function shouldAllowDowngrade(fromVersion: string, currentVersion: string): boolean {
  return versionCompare(fromVersion, currentVersion) >= 0;
}

/** A point-in-time snapshot of the schema + data state. */
export interface MigrationSnapshot<T = unknown> {
  readonly version: string;
  readonly data: T;
}

export interface MigrationState<T = unknown> {
  /** Apply a migration step built on top of the running state. */
  markMigrated(snapshot: MigrationSnapshot<T>): void;
  /** True when the current state is (still) healthy. */
  isHealthy(): boolean;
  /** Roll back to the last known healthy snapshot and return it. */
  recoverFromMigrationFailure(): MigrationSnapshot<T>;
}

/**
 * Migration state machine. `lastHealthy` is the most recently *confirmed*
 * healthy snapshot; `current` is the snapshot of the migration currently being
 * applied. While a migration is being applied the state is not yet healthy, so
 * a failure mid-migration can `recoverFromMigrationFailure()` to the last
 * healthy snapshot. Applying the next migration confirms the previous one.
 */
export function createMigrationState<T = unknown>(
  initial: MigrationSnapshot<T>,
): MigrationState<T> {
  let lastHealthy: MigrationSnapshot<T> = initial;
  let current: MigrationSnapshot<T> = initial;
  let healthy = true;

  return {
    markMigrated(snapshot) {
      // The still-current snapshot is now confirmed healthy; the new snapshot
      // becomes the in-progress migration whose success is not yet confirmed.
      lastHealthy = current;
      current = snapshot;
      healthy = false;
    },
    isHealthy() {
      return healthy;
    },
    recoverFromMigrationFailure() {
      current = lastHealthy;
      healthy = true;
      return lastHealthy;
    },
  };
}

export interface BackupEntry<T> {
  readonly id: string;
  readonly snapshot: T;
  readonly createdAtMs: number;
}

export interface BackupManager<T> {
  /** All stored backups, oldest first. */
  list(): readonly BackupEntry<T>[];
  /** Store a snapshot and return its backup id. */
  createBackup(snapshot: T): string;
  /**
   * Restore a backup by id. Atomic: the target snapshot is fully resolved
   * before the current state is swapped, so a failed restore (unknown id)
   * leaves the current data untouched.
   */
  restore(id: string): T;
  /** Always capture the current state as a fresh backup (for undo). Returns its id, or null if none yet. */
  restoreBeforeRestore(): string | null;
  /** Current in-memory state, or null before the first restore. */
  getCurrent(): T | null;
}

/**
 * In-memory backup manager with atomic restore. Snapshots are stored by id and
 * the current state is only ever swapped after the target backup is resolved.
 */
export function createBackupManager<T>(
  now: () => number = () => Date.now(),
): BackupManager<T> {
  const backups = new Map<string, BackupEntry<T>>();
  let current: T | null = null;
  let counter = 0;

  const createBackup = (snapshot: T): string => {
    counter += 1;
    const id = `backup-${counter}`;
    backups.set(id, { id, snapshot, createdAtMs: now() });
    return id;
  };

  return {
    list() {
      return Array.from(backups.values()).map((entry) => ({ ...entry }));
    },
    createBackup,
    restore(id) {
      const entry = backups.get(id);
      if (!entry) {
        // Failed restore: throw WITHOUT swapping the current state.
        throw new Error(`Backup not found: ${id}`);
      }
      // Atomic swap: resolve the target fully, then swap.
      const target = entry.snapshot;
      current = target;
      return target;
    },
    restoreBeforeRestore() {
      if (current === null) {
        return null;
      }
      return createBackup(current);
    },
    getCurrent() {
      return current;
    },
  };
}