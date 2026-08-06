/**
 * Retrieval-evidence visibility gating and citation field validation.
 *
 * Pure, deterministic helpers. No browser / Tauri / network access.
 */

import type { CitationStatus } from "./citationStatus";

export interface EvidenceGateInput {
  /** Whether the advanced mode is enabled in app settings. */
  readonly advancedMode: boolean;
  /** Whether a retrieval/rerank score should be surfaced. */
  readonly includeScore: boolean;
}

/**
 * Retrieval scores and rerank evidence are only ever surfaced in advanced
 * mode. Gating combines both flags so the score is never shown to a
 * non-advanced user even if it was requested.
 */
export function shouldRevealRetrievalEvidence(
  input: EvidenceGateInput,
): boolean {
  return input.advancedMode && input.includeScore;
}

/**
 * The fields a citation must carry to be treated as valid evidence. Anything
 * missing is flagged by `assertEvidenceFields`.
 */
export const EVIDENCE_REQUIRED_FIELDS = [
  "id",
  "sourceId",
  "textPreview",
  "passageLocator",
  "updatedAtMs",
  "syncState",
] as const;

export type EvidenceField = (typeof EVIDENCE_REQUIRED_FIELDS)[number];

export interface EvidenceCitation {
  readonly id?: string;
  readonly sourceId?: string;
  readonly textPreview?: string;
  readonly passageLocator?: string;
  readonly updatedAtMs?: number | null;
  readonly syncState?: CitationStatus;
}

/**
 * Validates that a citation exposes every required evidence field. Returns
 * the list of missing/invalid field names; an empty array means the citation
 * is fully valid.
 */
export function assertEvidenceFields(
  citation: EvidenceCitation,
): readonly EvidenceField[] {
  const missing: EvidenceField[] = [];
  if (!citation.id) {
    missing.push("id");
  }
  if (!citation.sourceId) {
    missing.push("sourceId");
  }
  if (!citation.textPreview) {
    missing.push("textPreview");
  }
  if (!citation.passageLocator) {
    missing.push("passageLocator");
  }
  if (typeof citation.updatedAtMs !== "number" || citation.updatedAtMs == null) {
    missing.push("updatedAtMs");
  }
  if (!citation.syncState) {
    missing.push("syncState");
  }
  return missing;
}