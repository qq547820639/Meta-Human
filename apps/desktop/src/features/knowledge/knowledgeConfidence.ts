/**
 * "I don't know" decision logic based on answer grounding confidence.
 *
 * Pure, deterministic helpers. No browser / Tauri / network access.
 */

export type AnswerConfidence = "confident" | "limited" | "unknown";

export interface EvaluateAnswerConfidenceInput {
  /** Whether at least one reliable (non-stale, non-deleted) source exists. */
  readonly hasReliableSource: boolean;
  /** Retrieval/rerank score of the best source, or null when unavailable. */
  readonly sourceScore: number | null;
  /** Minimum acceptable score for a confidently grounded answer. */
  readonly minScore: number;
  /** Whether the cited sources disagree (see citationStatus.conflictLevel). */
  readonly hasConflict: boolean;
}

/**
 * Decides how much an answer can be trusted given grounding evidence.
 *
 * - no reliable source             -> `unknown`
 * - sources disagree (conflict)    -> `limited`
 * - score unavailable              -> `limited`
 * - score below the minimum        -> `unknown`
 * - otherwise                      -> `confident`
 */
export function evaluateAnswerConfidence(
  input: EvaluateAnswerConfidenceInput,
): AnswerConfidence {
  const { hasReliableSource, sourceScore, minScore, hasConflict } = input;

  if (!hasReliableSource) {
    return "unknown";
  }
  if (hasConflict) {
    return "limited";
  }
  if (sourceScore == null) {
    return "limited";
  }
  if (sourceScore < minScore) {
    return "unknown";
  }
  return "confident";
}

/**
 * Whether the assistant should answer "I don't know" instead of guessing.
 * Only the strongest signal (`unknown`) triggers it; `limited` still allows a
 * hedged answer.
 */
export function shouldSayDontKnow(confidence: AnswerConfidence): boolean {
  return confidence === "unknown";
}