/**
 * Knowledge source sync status and rebuild-decision helpers.
 *
 * Pure, deterministic helpers. No browser / Tauri / network access.
 */

export type SourceSyncStatus = "synced" | "syncing" | "outdated" | "failed";

export interface ComputeSourceSyncInput {
  /** Last successful sync timestamp (ms epoch), or null if never synced. */
  readonly lastSyncAtMs: number | null;
  /** Last time the underlying/upstream source changed (ms epoch), or null. */
  readonly lastChangeAtMs: number | null;
  readonly nowMs: number;
  /** Whether a sync is currently running / pending. */
  readonly pendingChanges: boolean;
  /** Whether the most recent sync attempt failed. */
  readonly failed: boolean;
}

/**
 * Computes the sync status of a knowledge source.
 *
 * - `failed`: the last sync attempt failed.
 * - `syncing`: a sync is pending or in progress.
 * - `outdated`: never synced, or the source changed after the last sync.
 * - `synced`: last sync is current relative to any source changes.
 */
export function computeSourceSync(input: ComputeSourceSyncInput): SourceSyncStatus {
  const { lastSyncAtMs, lastChangeAtMs, failed, pendingChanges } = input;

  if (failed) {
    return "failed";
  }
  if (pendingChanges) {
    return "syncing";
  }
  if (lastSyncAtMs == null) {
    return "outdated";
  }
  if (lastChangeAtMs != null && lastChangeAtMs > lastSyncAtMs) {
    return "outdated";
  }
  return "synced";
}

export interface RebuildCheckInput {
  readonly lastSyncAtMs: number | null;
  readonly lastChangeAtMs: number | null;
  readonly nowMs: number;
  /** Max acceptable age of a sync before a rebuild is required (ms). */
  readonly maxAgeMs: number;
}

/**
 * Whether a source index needs to be rebuilt: never synced, changed after the
 * last sync, or older than `maxAgeMs`.
 */
export function sourceNeedsRebuild(input: RebuildCheckInput): boolean {
  const { lastSyncAtMs, lastChangeAtMs, nowMs, maxAgeMs } = input;
  if (lastSyncAtMs == null) {
    return true;
  }
  if (lastChangeAtMs != null && lastChangeAtMs > lastSyncAtMs) {
    return true;
  }
  if (nowMs - lastSyncAtMs > maxAgeMs) {
    return true;
  }
  return false;
}