/**
 * Memory candidate lifecycle state machine.
 *
 * A candidate starts as `proposed` and may transition to `confirmed`, `edited`
 * or `rejected`. Only `confirmed` and `edited` candidates are saved to
 * long-term memory; `proposed` and `rejected` are never persisted.
 *
 * Pure, immutable transitions. No browser / Tauri / network access.
 */

export type MemoryCandidateState = "proposed" | "confirmed" | "edited" | "rejected";

export interface MemoryCandidate {
  readonly id: string;
  readonly content: string;
  readonly state: MemoryCandidateState;
  readonly createdAtMs: number;
}

/** Creates a new candidate in the `proposed` state. */
export function proposeMemory(content: string): MemoryCandidate {
  return {
    id: "mem-" + Math.random().toString(36).slice(2, 10),
    content,
    state: "proposed",
    createdAtMs: Date.now(),
  };
}

/**
 * Confirms a proposed candidate. Only valid from `proposed`; any other state
 * is returned unchanged.
 */
export function confirm(candidate: MemoryCandidate): MemoryCandidate {
  if (candidate.state !== "proposed") {
    return candidate;
  }
  return { ...candidate, state: "confirmed" };
}

/**
 * Edits the content of a candidate. Allowed from `proposed` or `confirmed` or
 * `edited` (editing again), moving it to `edited`. A `rejected` candidate
 * cannot be resurrected.
 */
export function editContent(
  candidate: MemoryCandidate,
  newContent: string,
): MemoryCandidate {
  if (candidate.state === "rejected") {
    return candidate;
  }
  return { ...candidate, content: newContent, state: "edited" };
}

/**
 * Rejects a proposed candidate. Only valid from `proposed`.
 */
export function reject(candidate: MemoryCandidate): MemoryCandidate {
  if (candidate.state !== "proposed") {
    return candidate;
  }
  return { ...candidate, state: "rejected" };
}

/**
 * Whether a candidate enters long-term memory. Only `confirmed` and `edited`
 * states are saved; a `proposed` or `rejected` candidate is never persisted.
 */
export function isSaved(candidate: MemoryCandidate): boolean {
  return candidate.state === "confirmed" || candidate.state === "edited";
}