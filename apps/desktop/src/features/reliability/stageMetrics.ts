/**
 * Per-stage pipeline metrics (STT / LLM / TTS / avatar).
 *
 * Each stage record captures the wall-clock duration of one stage execution and
 * whether it succeeded. `stageLatency` aggregates the collected records for a
 * single stage into avg / P95 latency plus success/failure counts so the UI and
 * diagnostic summary can surface which pipeline link is slow or failing.
 *
 * Pure, no timers, no browser APIs.
 */

export type StageName = "stt" | "llm" | "tts" | "avatar";

export interface StageRecord {
  readonly stage: StageName;
  readonly startedAtMs: number;
  readonly finishedAtMs: number;
  readonly ok: boolean;
}

/** Append a stage record, returning a new array (immutable-update style). */
export function recordStage(
  stages: readonly StageRecord[],
  record: StageRecord,
): StageRecord[] {
  return [...stages, record];
}

export interface StageLatency {
  readonly avgMs: number | null;
  readonly p95Ms: number | null;
  readonly count: number;
  readonly failures: number;
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[index];
}

/**
 * Aggregate latency for a single stage. `count` is the number of records for
 * that stage; `failures` is how many of them returned `ok: false`. Latency is
 * computed over every record (successful or not). Empty input yields `null`
 * latencies and zero counts.
 */
export function stageLatency(
  stages: readonly StageRecord[],
  stage: StageName,
): StageLatency {
  const matching = stages.filter((record) => record.stage === stage);
  const latencies = matching
    .map((record) => record.finishedAtMs - record.startedAtMs)
    .sort((a, b) => a - b);

  return {
    avgMs:
      latencies.length === 0
        ? null
        : latencies.reduce((sum, value) => sum + value, 0) / latencies.length,
    p95Ms: latencies.length === 0 ? null : percentile(latencies, 95),
    count: matching.length,
    failures: matching.filter((record) => !record.ok).length,
  };
}