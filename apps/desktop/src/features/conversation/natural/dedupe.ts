/**
 * Duplicate-send / duplicate-save protection for the conversation pipeline.
 *
 * A stable message / generation id identifies one *logical* message. Under
 * races — a double-click on "send", a retried network submit, a barge-in that
 * re-enters the reply path, or a React strict-mode double-invoke — the same id
 * can be submitted for TTS / saved to the timeline twice. This pure guard keys
 * a set of handled ids so the second occurrence of an identical id is rejected
 * while distinct ids always pass.
 *
 * The guard holds NO timers and has no notion of time; it is a plain set with a
 * bounded size so a long-running session never leaks memory.
 */
export interface DedupeGuard {
  /** True when `id` has already been marked handled. */
  alreadyHandled(id: string): boolean;
  /**
   * Mark `id` as handled. Returns `true` when this call newly claimed the id,
   * or `false` when the id was already handled (a duplicate — caller must drop
   * the submit/save).
   */
  markHandled(id: string): boolean;
  /** Drop all tracked ids (e.g. a fresh conversation / engine reset). */
  reset(): void;
}

export interface DedupeGuardOptions {
  /**
   * Maximum number of ids retained before the oldest are evicted. Bounds memory
   * on long-running sessions. Default 10_000.
   */
  readonly maxSize?: number;
}

export function createDedupeGuard(
  options: DedupeGuardOptions = {},
): DedupeGuard {
  const maxSize = options.maxSize ?? 10_000;
  const seen = new Set<string>();

  return {
    alreadyHandled(id) {
      return seen.has(id);
    },
    markHandled(id) {
      if (seen.has(id)) {
        return false;
      }
      seen.add(id);
      // Bounded memory: evict the oldest ids once the set overflows.
      if (seen.size > maxSize) {
        const oldest = seen.values().next().value;
        if (oldest !== undefined) {
          seen.delete(oldest);
        }
      }
      return true;
    },
    reset() {
      seen.clear();
    },
  };
}