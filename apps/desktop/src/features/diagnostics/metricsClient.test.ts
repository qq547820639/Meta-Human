import { afterEach, describe, expect, it, vi } from "vitest";

import { getProviderMetrics, formatProviderHealth } from "./metricsClient";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => ({
    baseUrl: "http://127.0.0.1:43210",
    bearerToken: "test-token",
  })),
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

const summary = {
  providers: [
    {
      provider: "llm_chat",
      total: 10,
      success: 8,
      error: 1,
      cancelled: 1,
      degraded: 0,
      error_rate: 0.1,
      cancel_rate: 0.1,
      degraded_rate: 0.0,
      avg_latency_ms: 120.0,
      p95_latency_ms: 300.0,
    },
  ],
  total_calls: 10,
  total_error_rate: 0.1,
  total_cancel_rate: 0.1,
  total_degraded_rate: 0.0,
};

describe("getProviderMetrics", () => {
  it("fetches provider metrics from the sidecar endpoint", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify(summary), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    const result = await getProviderMetrics();

    expect(result.total_calls).toBe(10);
    expect(result.providers[0].provider).toBe("llm_chat");
    expect(result.providers[0].error_rate).toBe(0.1);
  });
});

describe("formatProviderHealth", () => {
  it("renders a compact health label", () => {
    const label = formatProviderHealth(summary.providers[0]);
    expect(label).toContain("调用 10");
    expect(label).toContain("平均 120ms");
    expect(label).toContain("P95 300ms");
    expect(label).toContain("错误 10%");
    expect(label).toContain("取消 10%");
  });

  it("omits zero-rate and null-latency segments", () => {
    const label = formatProviderHealth({
      provider: "tts_synthesize",
      total: 0,
      success: 0,
      error: 0,
      cancelled: 0,
      degraded: 0,
      error_rate: 0,
      cancel_rate: 0,
      degraded_rate: 0,
      avg_latency_ms: null,
      p95_latency_ms: null,
    });
    expect(label).toContain("调用 0");
    expect(label).not.toContain("错误");
    expect(label).not.toContain("平均");
  });
});