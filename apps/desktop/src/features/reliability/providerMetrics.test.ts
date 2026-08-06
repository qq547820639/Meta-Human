import { describe, expect, it } from "vitest";

import {
  classifyProviderError,
  recordProviderCall,
  sliceToWindow,
  summarizeProviderCalls,
  type ProviderCall,
} from "./providerMetrics";

describe("classifyProviderError", () => {
  it("classifies timeout by message and name", () => {
    expect(classifyProviderError(new Error("request timed out"))).toBe("timeout");
    expect(classifyProviderError(new DOMException("x", "TimeoutError"))).toBe("timeout");
    expect(classifyProviderError({ message: "deadline exceeded" })).toBe("timeout");
  });

  it("classifies auth by status and message", () => {
    expect(classifyProviderError({ status: 401 })).toBe("auth");
    expect(classifyProviderError({ statusCode: 403 })).toBe("auth");
    expect(classifyProviderError(new Error("invalid api key"))).toBe("auth");
    expect(classifyProviderError({ message: "Unauthorized" })).toBe("auth");
  });

  it("classifies rate_limit by status and message", () => {
    expect(classifyProviderError({ status: 429 })).toBe("rate_limit");
    expect(classifyProviderError(new Error("rate limit exceeded"))).toBe("rate_limit");
    expect(classifyProviderError({ data: { message: "too many requests" } })).toBe("rate_limit");
  });

  it("classifies network by message", () => {
    expect(classifyProviderError(new TypeError("fetch failed"))).toBe("network");
    expect(classifyProviderError({ message: "ECONNREFUSED" })).toBe("network");
    expect(classifyProviderError({ message: "network connection lost" })).toBe("network");
  });

  it("classifies server by status and message", () => {
    expect(classifyProviderError({ status: 500 })).toBe("server");
    expect(classifyProviderError({ status: 503 })).toBe("server");
    expect(classifyProviderError(new Error("internal server error"))).toBe("server");
  });

  it("classifies everything else as unknown", () => {
    expect(classifyProviderError(new Error("something odd"))).toBe("unknown");
    expect(classifyProviderError(null)).toBe("unknown");
    expect(classifyProviderError(undefined)).toBe("unknown");
    expect(classifyProviderError(42)).toBe("unknown");
  });

  it("treats a 408 / 504 status as timeout", () => {
    expect(classifyProviderError({ status: 408 })).toBe("timeout");
    expect(classifyProviderError({ status: 504 })).toBe("timeout");
  });
});

describe("recordProviderCall / sliceToWindow", () => {
  const call = (started: number, finished: number): ProviderCall => ({
    provider: "llm",
    operation: "chat",
    startedAtMs: started,
    finishedAtMs: finished,
    ok: true,
    errorKind: null,
  });

  it("recordProviderCall appends immutably", () => {
    const a = [call(0, 10)];
    const b = recordProviderCall(a, call(10, 20));
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(2);
  });

  it("sliceToWindow keeps only calls starting in the window", () => {
    const calls = [call(0, 5), call(10, 15), call(20, 25)];
    const sliced = sliceToWindow(calls, 5, 20);
    expect(sliced.map((c) => c.startedAtMs)).toEqual([10, 20]);
  });
});

describe("summarizeProviderCalls", () => {
  const call = (
    started: number,
    finished: number,
    ok: boolean,
    errorKind: ProviderCall["errorKind"] = null,
  ): ProviderCall => ({
    provider: "llm",
    operation: "chat",
    startedAtMs: started,
    finishedAtMs: finished,
    ok,
    errorKind,
  });

  it("computes totals, avgs and p95", () => {
    // latencies: 100, 200, ..., 1000 (10 samples)
    const calls = Array.from({ length: 10 }, (_, i) => call(i * 100, i * 100 + 100 * (i + 1), true));
    const summary = summarizeProviderCalls(calls);

    expect(summary.total).toBe(10);
    expect(summary.ok).toBe(10);
    expect(summary.failed).toBe(0);
    expect(summary.avgLatencyMs).toBe(550);
    // p95 (nearest-rank) of 10 values sorted ascending => index 9 => 1000
    expect(summary.p95LatencyMs).toBe(1000);
  });

  it("counts failures by error kind", () => {
    const calls = [
      call(0, 10, false, "timeout"),
      call(0, 10, false, "auth"),
      call(0, 10, false, "timeout"),
      call(0, 10, true),
    ];
    const summary = summarizeProviderCalls(calls);

    expect(summary.total).toBe(4);
    expect(summary.ok).toBe(1);
    expect(summary.failed).toBe(3);
    expect(summary.byErrorKind.timeout).toBe(2);
    expect(summary.byErrorKind.auth).toBe(1);
    expect(summary.byErrorKind.network).toBe(0);
  });

  it("returns null latencies and zero counts for empty input", () => {
    const summary = summarizeProviderCalls([]);
    expect(summary.total).toBe(0);
    expect(summary.avgLatencyMs).toBeNull();
    expect(summary.p95LatencyMs).toBeNull();
    expect(summary.byErrorKind.unknown).toBe(0);
  });
});