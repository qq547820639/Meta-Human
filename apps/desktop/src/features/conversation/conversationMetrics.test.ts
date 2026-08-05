import { describe, expect, it } from "vitest";

import {
  emptyConversationMetrics,
  formatMetricsLabel,
  mergeMetrics,
} from "./conversationMetrics";

describe("conversationMetrics", () => {
  it("starts empty and stays empty until a metric is measured", () => {
    expect(emptyConversationMetrics).toEqual({
      firstCharMs: null,
      fullResponseMs: null,
      ttsStartupMs: null,
      avatarReadyMs: null,
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
});