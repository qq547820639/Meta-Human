/**
 * Reply latency metrics captured across the streaming pipeline. Each value is
 * measured with `performance.now()` and exposed to the UI so the user (or a
 * diagnostic log) can inspect how long each stage of an exchange took.
 *
 *   - firstCharMs     : send -> first visible token
 *   - fullResponseMs  : send -> finished answer
 *   - ttsStartupMs    : TTS ready -> audio actually playing
 *   - avatarReadyMs   : stream URL provided -> video loaded
 *
 * Natural-conversation ("hands-free") budget metrics:
 *
 *   - speechToFirstTranscriptMs : speech start -> first interim transcript char
 *   - speechEndToTranscriptMs   : speech end -> final (confirmed) transcript
 *   - submitToFirstTokenMs      : transcript submitted -> first reply token
 *   - firstTokenToFirstAudioMs  : first reply token -> first TTS audio chunk
 *   - avSyncErrorMs             : measured audio/video sync deviation
 *   - interruptToSilenceMs      : interrupt issued -> assistant audio stopped
 */
export interface ConversationMetrics {
  readonly firstCharMs: number | null;
  readonly fullResponseMs: number | null;
  readonly ttsStartupMs: number | null;
  readonly avatarReadyMs: number | null;
  // natural-conversation budget metrics
  readonly speechToFirstTranscriptMs: number | null;
  readonly speechEndToTranscriptMs: number | null;
  readonly submitToFirstTokenMs: number | null;
  readonly firstTokenToFirstAudioMs: number | null;
  readonly avSyncErrorMs: number | null;
  readonly interruptToSilenceMs: number | null;
}

export const emptyConversationMetrics: ConversationMetrics = {
  firstCharMs: null,
  fullResponseMs: null,
  ttsStartupMs: null,
  avatarReadyMs: null,
  speechToFirstTranscriptMs: null,
  speechEndToTranscriptMs: null,
  submitToFirstTokenMs: null,
  firstTokenToFirstAudioMs: null,
  avSyncErrorMs: null,
  interruptToSilenceMs: null,
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
  return parts.join(" · ");
}