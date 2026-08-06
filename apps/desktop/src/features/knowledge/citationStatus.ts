/**
 * Citation status classification and cross-source conflict detection.
 *
 * Pure, deterministic helpers. No browser / Tauri / network access.
 */

export type CitationStatus = "fresh" | "stale" | "deleted" | "unknown";

export interface CitationStatusInput {
  /** Last time the local knowledge store synced this source (ms epoch). */
  readonly sourceSyncedAtMs: number | null;
  /** Last time the upstream/original source reported a change (ms epoch). */
  readonly sourceUpdatedAtMs: number | null;
  readonly nowMs: number;
  /** A citation is considered stale once it is older than this (ms). */
  readonly staleAfterMs: number;
  /** Whether the referenced document still exists in the store. */
  readonly referencedDocExists: boolean;
}

/**
 * Classifies how trustworthy a citation is based on sync freshness and
 * whether the referenced document still exists.
 *
 * - `deleted`: the referenced document no longer exists.
 * - `unknown`: we have no sync timestamp, so freshness cannot be judged.
 * - `stale`: the source changed after our last sync, or the sync is so old
 *   that it exceeds `staleAfterMs`.
 * - `fresh`: synced recently and no upstream change is pending.
 */
export function classifyCitationStatus(
  input: CitationStatusInput,
): CitationStatus {
  const {
    sourceSyncedAtMs,
    sourceUpdatedAtMs,
    nowMs,
    staleAfterMs,
    referencedDocExists,
  } = input;

  if (!referencedDocExists) {
    return "deleted";
  }
  if (sourceSyncedAtMs == null) {
    return "unknown";
  }
  if (sourceUpdatedAtMs != null && sourceUpdatedAtMs > sourceSyncedAtMs) {
    return "stale";
  }
  if (nowMs - sourceSyncedAtMs > staleAfterMs) {
    return "stale";
  }
  return "fresh";
}

/**
 * Metadata carried by a citation relevant to credibility/conflict analysis.
 */
export interface CitationMeta {
  readonly id: string;
  readonly sourceId: string;
  readonly textPreview: string;
  readonly passageLocator: string;
  readonly updatedAtMs: number;
  readonly syncState: CitationStatus;
}

export type ConflictLevel = "none" | "minor" | "conflict";

/**
 * Estimates whether the cited sources disagree.
 *
 * - `none`: no citations, or all citations come from a single source.
 * - `minor`: multiple sources are cited but one source dominates (weak
 *   evidence of disagreement).
 * - `conflict`: multiple sources are cited with comparable weight, i.e. no
 *   single source is dominant, which suggests the sources may disagree.
 */
export function conflictLevel(citations: readonly CitationMeta[]): ConflictLevel {
  if (citations.length === 0) {
    return "none";
  }
  const counts = new Map<string, number>();
  for (const citation of citations) {
    counts.set(citation.sourceId, (counts.get(citation.sourceId) ?? 0) + 1);
  }
  const distinctSources = counts.size;
  if (distinctSources < 2) {
    return "none";
  }
  const maxCount = Math.max(...counts.values());
  // A source is "dominant" only when it holds a strict majority. A perfect
  // tie (e.g. 2 vs 2) is treated as a genuine conflict.
  const dominant = maxCount * 2 > citations.length;
  return dominant ? "minor" : "conflict";
}