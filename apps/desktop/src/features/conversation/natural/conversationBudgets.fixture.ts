/**
 * Sample latency measurements for the conversation performance-budget CI
 * benchmark. Values represent realistic per-turn latencies (in ms) observed
 * across a session of natural-conversation exchanges. The P95 of every stage is
 * deliberately within budget so the default CI run is green; the benchmark can
 * be run with an out-of-budget fixture to prove the gate fails.
 */

import type { ConversationBudgetMetric } from "./conversationBudgets";

export interface ConversationBudgetFixture {
  /** Human-readable label for the report. */
  readonly label: string;
  readonly samples: Partial<Record<ConversationBudgetMetric, ReadonlyArray<number>>>;
}

/**
 * Baseline run: every stage's P95 is within its budget. Sorted-ascending P95
 * (nearest-rank, index = ceil(0.95*n)-1) confirmation:
 *   speechToFirstTranscriptMs : 410  < 500
 *   speechEndToTranscriptMs   : 620  < 800
 *   submitToFirstTokenMs      : 1380 < 1500
 *   firstTokenToFirstAudioMs  : 1760 < 2000
 *   avSyncErrorMs             : 150  < 300
 *   interruptToSilenceMs      : 170  < 300
 */
export const baselineConversationBudgetSamples: ConversationBudgetFixture = {
  label: "baseline-p95",
  samples: {
    speechToFirstTranscriptMs: [220, 310, 190, 260, 410, 350, 280, 240, 330, 300],
    speechEndToTranscriptMs: [360, 480, 420, 510, 390, 620, 450, 400, 470, 440],
    submitToFirstTokenMs: [720, 980, 860, 1120, 940, 1380, 900, 1010, 880, 1240],
    firstTokenToFirstAudioMs: [980, 1240, 1120, 1480, 1290, 1760, 1180, 1350, 1100, 1560],
    avSyncErrorMs: [40, 90, 60, 120, 70, 150, 80, 110, 55, 95],
    interruptToSilenceMs: [60, 110, 80, 140, 90, 170, 100, 130, 75, 120],
  },
};

/**
 * A deliberately-over-budget fixture used to prove the CI gate fails when a
 * stage regresses. TTS latency and audio AGC both blow their budget here.
 */
export const degradedConversationBudgetSamples: ConversationBudgetFixture = {
  label: "degraded-p95",
  samples: {
    speechToFirstTranscriptMs: [220, 310, 190, 260, 410, 350, 280, 240, 330, 300],
    submitToFirstTokenMs: [720, 980, 860, 1120, 940, 1380, 900, 1010, 880, 1240],
    firstTokenToFirstAudioMs: [980, 2400, 2600, 3100, 2900, 3400, 2200, 2350, 2500, 2800],
    avSyncErrorMs: [200, 300, 380, 450, 420, 500, 320, 400, 360, 480],
    interruptToSilenceMs: [60, 110, 80, 140, 90, 170, 100, 130, 75, 120],
  },
};