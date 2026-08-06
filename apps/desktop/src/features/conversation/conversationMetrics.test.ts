import { describe, expect, it } from "vitest";

import {
  emptyConversationMetrics,
  formatMetricsLabel,
  mergeMetrics,
  percentileLatencies,
} from "./conversationMetrics";

describe("conversationMetrics", () => {
  it("starts empty and stays empty until a metric is measured", () => {
    expect(emptyConversationMetrics).toEqual({
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
    });
    expect(formatMetricsLabel(emptyConversationMetrics)).toBe("");
  });

  it("merges partial measurements without clobbering existing ones", () => {
    const first = mergeMetrics(emptyConversationMetrics, {
      firstCharMs: 120,
      fullResponseMs: 2400,
    });
    const second = mergeMetrics(first, { ttsStartupMs: 300 });
    expect(second).toEqual({
      firstCharMs: 120,
      fullResponseMs: 2400,
      ttsStartupMs: 300,
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
    });
  });

  it("formats a compact human-readable label with measured values only", () => {
    const label = formatMetricsLabel(
      mergeMetrics(emptyConversationMetrics, {
        firstCharMs: 120,
        fullResponseMs: 2400,
        ttsStartupMs: 300,
        avatarReadyMs: 950,
      }),
    );
    expect(label).toBe("首字 120ms · 回答 2400ms · TTS 300ms · 头像 950ms");
  });

  it("computes P50/P95 over real samples (nearest-rank)", () => {
    const result = percentileLatencies([100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]);
    expect(result.sampleCount).toBe(10);
    expect(result.p50).toBe(500);
    expect(result.p95).toBe(1000);
  });

  it("reports no percentiles when there are no measured samples", () => {
    expect(percentileLatencies([])).toEqual({ p50: null, p95: null, sampleCount: 0 });
    expect(percentileLatencies([null, null, null])).toEqual({
      p50: null,
      p95: null,
      sampleCount: 0,
    });
  });

  it("ignores null samples so a partial turn never skews a percentile", () => {
    const result = percentileLatencies([100, null, 200, null, 300]);
    expect(result.sampleCount).toBe(3);
    expect(result.p50).toBe(200);
  });

  it("handles a single sample: p50 and p95 both equal the sample", () => {
    const result = percentileLatencies([42]);
    expect(result).toEqual({ p50: 42, p95: 42, sampleCount: 1 });
  });
});