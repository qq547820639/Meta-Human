/**
 * Reply latency metrics captured across the streaming pipeline. Each value is
 * measured with `performance.now()` and exposed to the UI so the user (or a
 * diagnostic log) can inspect how long each stage of an exchange took.
 *
 *   - firstCharMs     : send -> first visible token
 *   - fullResponseMs  : send -> finished answer
 *   - ttsStartupMs    : TTS ready -> audio actually playing
 *   - avatarReadyMs   : stream URL provided -> video loaded
 */
export interface ConversationMetrics {
  readonly firstCharMs: number | null;
  readonly fullResponseMs: number | null;
  readonly ttsStartupMs: number | null;
  readonly avatarReadyMs: number | null;
}

export const emptyConversationMetrics: ConversationMetrics = {
  firstCharMs: null,
  fullResponseMs: null,
  ttsStartupMs: null,
  avatarReadyMs: null,
};

/** Merges a partial, newly-measured metric into the running snapshot. */
export function mergeMetrics(
  current: ConversationMetrics,
  next: Partial<ConversationMetrics>,
): ConversationMetrics {
  return { ...current, ...next };
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
  return parts.join(" · ");
}