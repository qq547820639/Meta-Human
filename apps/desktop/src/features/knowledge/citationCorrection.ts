/**
 * State machine for user correction of a citation.
 *
 * Pure, immutable transitions. No browser / Tauri / network access.
 */

export type CorrectionState = "none" | "proposed" | "accepted" | "rejected";

export interface CorrectionStatus {
  readonly original: string | null;
  readonly corrected: string | null;
  readonly state: CorrectionState;
}

/** Creates the initial, no-correction state. */
export function createCorrectionStatus(): CorrectionStatus {
  return { original: null, corrected: null, state: "none" };
}

/**
 * Proposes a correction. Only allowed from `none` or `rejected` (a previously
 * rejected correction may be re-proposed). Returns the new state.
 */
export function proposeCorrection(
  status: CorrectionStatus,
  original: string,
  corrected: string,
): CorrectionStatus {
  if (status.state === "none" || status.state === "rejected") {
    return { original, corrected, state: "proposed" };
  }
  return status;
}

/**
 * Accepts a proposed correction. Only allowed from `proposed` — accepting
 * before proposing is a no-op.
 */
export function accept(status: CorrectionStatus): CorrectionStatus {
  if (status.state !== "proposed") {
    return status;
  }
  return { ...status, state: "accepted" };
}

/**
 * Rejects a proposed correction. Only allowed from `proposed`.
 */
export function reject(status: CorrectionStatus): CorrectionStatus {
  if (status.state !== "proposed") {
    return status;
  }
  return { ...status, state: "rejected" };
}

/** Resets to the initial state, discarding any correction. */
export function reset(_status: CorrectionStatus): CorrectionStatus {
  return createCorrectionStatus();
}