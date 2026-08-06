/**
 * Reply latency metrics captured across the streaming pipeline. Each value is
 * measured with `performance.now()` and exposed to the UI so the user (or a
 * diagnostic log) can inspect how long each stage of an exchange took.
 *
 *   - firstCharMs     : send -> first visible token
 *   - fullResponseMs  : send -> finished answer
 *   - ttsStartupMs    : TTS ready -> audio actually playing
 *   - avatarReadyMs   : stream URL provided -> video loaded
 *   - avatarSessionToFirstFrameMs : session created -> first video frame
 *   - avatarReconnectMs : stream dropped -> video playing again
 *
 * Natural-conversation ("hands-free") budget metrics:
 *
 *   - speechToFirstTranscriptMs : speech start -> first interim transcript char
 *   - speechEndToTranscriptMs   : speech end -> final (confirmed) transcript
 *   - submitToFirstTokenMs      : transcript submitted -> first reply token
 *   - firstTokenToFirstAudioMs  : first reply token -> first TTS audio chunk
 *   - avSyncErrorMs             : measured audio/video sync deviation
 *   - interruptToSilenceMs      : interrupt issued -> assistant audio stopped
 *
 * Echo-gate counters (Task D) — no raw voice content, only counts of how the
 * playback-aware echo gate classified VAD speech-start events:
 *
 *   - vadFalseTriggerCount : speech-start events seen while the assistant was
 *     audible (potential false triggers from the assistant's own voice).
 *   - echoSuppressedCount  : how many of those were suppressed as suspected echo.
 *   - validBargeInCount    : how many passed through as a real user barge-in.
 */
export interface EchoMetrics {
  readonly vadFalseTriggerCount: number;
  readonly echoSuppressedCount: number;
  readonly validBargeInCount: number;
}

export interface ConversationMetrics {
  readonly firstCharMs: number | null;
  readonly fullResponseMs: number | null;
  readonly ttsStartupMs: number | null;
  readonly avatarReadyMs: number | null;
  readonly avatarSessionToFirstFrameMs: number | null;
  readonly avatarReconnectMs: number | null;
  // natural-conversation budget metrics
  readonly speechToFirstTranscriptMs: number | null;
  readonly speechEndToTranscriptMs: number | null;
  readonly submitToFirstTokenMs: number | null;
  readonly firstTokenToFirstAudioMs: number | null;
  readonly avSyncErrorMs: number | null;
  readonly interruptToSilenceMs: number | null;
  readonly echoMetrics: EchoMetrics | null;
}

export const emptyConversationMetrics: ConversationMetrics = {
  firstCharMs: null,
  fullResponseMs: null,
  ttsStartupMs: null,
  avatarReadyMs: null,
  avatarSessionToFirstFrameMs: null,
  avatarReconnectMs: null,
  speechToFirstTranscriptMs: null,
  speechEndToTranscriptMs: null,
  submitToFirstTokenMs: null,
  firstTokenToFirstAudioMs: null,
  avSyncErrorMs: null,
  interruptToSilenceMs: null,
  echoMetrics: null,
};

/** Merges a partial, newly-measured metric into the running snapshot. */
export function mergeMetrics(
  current: ConversationMetrics,
  next: Partial<ConversationMetrics>,
): ConversationMetrics {
  return { ...current, ...next };
}

/**
 * Perc50 / Perc95 latency thresholds over a set of measured samples.
 *
 * Values are computed from the real collected samples (nearest-rank method);
 * no thresholds are fabricated when there are no measurements. `null` samples
 * are ignored so a partially-filled turn never skews a percentile.
 */
export interface LatencyPercentiles {
  readonly p50: number | null;
  readonly p95: number | null;
  /** Number of non-null samples used to compute the percentiles. */
  readonly sampleCount: number;
}

/**
 * Compute P50/P95 from a list of measured latencies (ms). Empty or all-null
 * input yields `{ p50: null, p95: null, sampleCount: 0 }` — never a fabricated
 *达标 value.
 */
export function percentileLatencies(samples: ReadonlyArray<number | null>): LatencyPercentiles {
  const valid = samples.filter((value): value is number => value !== null);
  if (valid.length === 0) {
    return { p50: null, p95: null, sampleCount: 0 };
  }
  const sorted = [...valid].sort((a, b) => a - b);
  const at = (percentile: number): number => {
    const index = Math.min(
      sorted.length - 1,
      Math.max(0, Math.ceil((percentile / 100) * sorted.length) - 1),
    );
    return sorted[index];
  };
  return {
    p50: at(50),
    p95: at(95),
    sampleCount: valid.length,
  };
}

/** Compact human-readable label for the measured metrics (empty when none). */
export function formatMetricsLabel(metrics: ConversationMetrics): string {
  const parts: string[] = [];
  if (metrics.firstCharMs !== null) {
    parts.push(`首字 ${Math.round(metrics.firstCharMs)}ms`);
  }
  if (metrics.fullResponseMs !== null) {
    parts.push(`回答 ${Math.round(metrics.fullResponseMs)}ms`);
  }
  if (metrics.ttsStartupMs !== null) {
    parts.push(`TTS ${Math.round(metrics.ttsStartupMs)}ms`);
  }
  if (metrics.avatarReadyMs !== null) {
    parts.push(`头像 ${Math.round(metrics.avatarReadyMs)}ms`);
  }
  if (metrics.avatarSessionToFirstFrameMs !== null) {
    parts.push(`会话→首帧 ${Math.round(metrics.avatarSessionToFirstFrameMs)}ms`);
  }
  if (metrics.avatarReconnectMs !== null) {
    parts.push(`断线→恢复 ${Math.round(metrics.avatarReconnectMs)}ms`);
  }
  if (metrics.speechToFirstTranscriptMs !== null) {
    parts.push(`说话→转写 ${Math.round(metrics.speechToFirstTranscriptMs)}ms`);
  }
  if (metrics.speechEndToTranscriptMs !== null) {
    parts.push(`停说→转写 ${Math.round(metrics.speechEndToTranscriptMs)}ms`);
  }
  if (metrics.submitToFirstTokenMs !== null) {
    parts.push(`提交→首token ${Math.round(metrics.submitToFirstTokenMs)}ms`);
  }
  if (metrics.firstTokenToFirstAudioMs !== null) {
    parts.push(`首token→语音 ${Math.round(metrics.firstTokenToFirstAudioMs)}ms`);
  }
  if (metrics.avSyncErrorMs !== null) {
    parts.push(`音画偏差 ${Math.round(metrics.avSyncErrorMs)}ms`);
  }
  if (metrics.interruptToSilenceMs !== null) {
    parts.push(`打断→静音 ${Math.round(metrics.interruptToSilenceMs)}ms`);
  }
  if (metrics.echoMetrics) {
    parts.push(
      `回声抑制 ${metrics.echoMetrics.echoSuppressedCount}/${metrics.echoMetrics.vadFalseTriggerCount}`,
    );
  }
  return parts.join(" · ");
}