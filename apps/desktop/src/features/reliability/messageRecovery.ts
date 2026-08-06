/**
 * Crash recovery for unfinished messages + duplicate-call / duplicate-save
 * protection.
 *
 * If the app (or sidecar) crashes mid-turn, a message that was in flight is
 * left in a non-terminal state. `recoverUnfinishedMessages` marks exactly those
 * messages as `pending_retry` so the caller can re-drive them on startup.
 *
 * Duplicate protection reuses the existing `createDedupeGuard` from
 * `conversation/natural/dedupe.ts` (a bounded set keyed by operation id) to
 * prevent a single logical message from triggering two model calls or two
 * timeline saves under races / strict mode / retries.
 */

import type { DedupeGuard, DedupeGuardOptions } from "../conversation/natural/dedupe";
import { createDedupeGuard } from "../conversation/natural/dedupe";

/** Reuse the existing dedupe implementation (bounded set keyed by id). */
export { createDedupeGuard };
export type { DedupeGuard, DedupeGuardOptions };

/** Message statuses that are not final and can be retried after a crash. */
const UNFINISHED_STATUSES: ReadonlySet<string> = new Set([
  "pending",
  "queued",
  "processing",
  "in_flight",
  "in_progress",
  "pending_retry",
]);

export interface RecoverResult<T> {
  /** The messages that were marked `pending_retry` by this recovery. */
  readonly recovered: readonly T[];
  /** The full store with those messages updated in place. */
  readonly store: readonly T[];
}

export interface RecoverOptions {
  /** Ids that were in flight when the crash happened. */
  readonly inFlightIds: ReadonlySet<string>;
}

/**
 * Mark messages that were in flight during a crash as `pending_retry` and
 * return them alongside the updated store. Messages that are already terminal
 * (done / failed / cancelled) or already `pending_retry` are left untouched.
 */
export function recoverUnfinishedMessages<T extends { id: string; status: string }>(
  store: readonly T[],
  { inFlightIds }: RecoverOptions,
): RecoverResult<T> {
  const recovered: T[] = [];
  const next = store.map((message) => {
    if (
      inFlightIds.has(message.id) &&
      UNFINISHED_STATUSES.has(message.status) &&
      message.status !== "pending_retry"
    ) {
      const updated = { ...message, status: "pending_retry" as T["status"] };
      recovered.push(updated);
      return updated;
    }
    return message;
  });
  return { recovered, store: next };
}