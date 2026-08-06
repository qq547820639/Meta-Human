import { describe, expect, it } from "vitest";

import {
  buildDiagnosticSummary,
  diagnosticSummaryLines,
} from "./diagnosticSummary";
import type { ProviderCall } from "./providerMetrics";
import type { StageRecord } from "./stageMetrics";

const providerCall = (
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

const stageRecord = (
  stage: StageRecord["stage"],
  started: number,
  finished: number,
  ok: boolean,
): StageRecord => ({ stage, startedAtMs: started, finishedAtMs: finished, ok });

describe("buildDiagnosticSummary", () => {
  it("contains the key fields", () => {
    const summary = buildDiagnosticSummary({
      correlationId: "0123456789abcdef",
      providerMetrics: [
        providerCall(0, 100, true),
        providerCall(0, 200, false, "timeout"),
      ],
      stageMetrics: [stageRecord("stt", 0, 50, true)],
      logSample: ["sidecar started", "ready"],
      secrets: [],
    });

    expect(summary).toContain("关联ID: 0123456789abcdef");
    expect(summary).toContain("总数: 2");
    expect(summary).toContain("成功: 1");
    expect(summary).toContain("失败: 1");
    expect(summary).toContain("错误分布: timeout:1");
    expect(summary).toContain("stt: 平均 50ms");
    expect(summary).toContain("sidecar started");
  });

  it("redacts literal secrets and default token patterns", () => {
    const summary = buildDiagnosticSummary({
      correlationId: "0123456789abcdef",
      providerMetrics: [],
      stageMetrics: [],
      logSample: ["token=sk-abcdefgh12345678", "key=hunter2"],
      secrets: ["hunter2"],
    });

    expect(summary).not.toContain("sk-abcdefgh12345678");
    expect(summary).not.toContain("hunter2");
    expect(summary).toContain("[REDACTED]");
  });

  it("is a valid multi-line string once split", () => {
    const summary = buildDiagnosticSummary({
      correlationId: "0123456789abcdef",
      providerMetrics: [],
      stageMetrics: [],
      logSample: [],
      secrets: [],
    });
    const lines = diagnosticSummaryLines(summary);
    expect(lines.length).toBeGreaterThan(3);
    expect(lines[0]).toBe("VoxStudio 诊断摘要");
  });
});