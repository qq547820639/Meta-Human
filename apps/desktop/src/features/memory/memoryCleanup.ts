/**
 * Avatar-deletion memory cleanup planning.
 *
 * Deleting an avatar must mark its local memories for deletion and, when
 * remote sync is enabled, request a remote cleanup. The cleanup is only
 * `verifiable` when the local deletion list is non-empty AND (remote sync is
 * disabled OR the remote cleanup has been confirmed).
 *
 * Pure, deterministic helpers. No browser / Tauri / network access.
 */

export interface CleanupPlan {
  readonly localMemoriesToDelete: string[];
  readonly remoteRequested: boolean;
  readonly verifiable: boolean;
}

export interface CleanupInput {
  readonly avatarId: string;
  readonly remoteSyncEnabled: boolean;
  /** Whether the remote cleanup was confirmed (defaults to false). */
  readonly remoteConfirmed?: boolean;
}

/** Storage key for the memory bucket belonging to an avatar. */
export function memoryBucketKey(avatarId: string): string {
  return `avatar:memories:${avatarId}`;
}

/**
 * Plans the cleanup of an avatar's memories.
 *
 * - `localMemoriesToDelete` always contains the avatar's local memory bucket.
 * - `remoteRequested` is true when remote sync is enabled.
 * - `verifiable` is true only when the local delete list is non-empty AND
 *   (remote sync is disabled OR the remote cleanup was confirmed).
 */
export function planMemoryCleanup(input: CleanupInput): CleanupPlan {
  const { avatarId, remoteSyncEnabled, remoteConfirmed = false } = input;
  const localMemoriesToDelete = [memoryBucketKey(avatarId)];
  const remoteRequested = remoteSyncEnabled;
  const remoteOk = !remoteSyncEnabled || remoteConfirmed;
  const verifiable = localMemoriesToDelete.length > 0 && remoteOk;
  return { localMemoriesToDelete, remoteRequested, verifiable };
}