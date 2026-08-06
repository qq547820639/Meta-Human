/**
 * Compact, human-readable diagnostic summary with one-click copy + redaction.
 *
 * Combines a correlation id, provider call metrics and stage metrics into a
 * short, copy-pasteable report. Every line is passed through the same redaction
 * semantics as `secureStorage.redactDiagnostic` (literal secrets + well-known
 * token patterns are masked) so the summary is safe to paste into an issue or
 * pastebin without leaking keys.
 *
 * Pure — no I/O, no clipboard, no browser APIs. Copying is left to the caller.
 */

import { redactDiagnostic } from "../privacy/secureStorage";
import {
  summarizeProviderCalls,
  type ProviderCall,
} from "./providerMetrics";
import {
  stageLatency,
  type StageName,
  type StageRecord,
} from "./stageMetrics";

export interface DiagnosticSummaryInput {
  readonly correlationId: string;
  readonly providerMetrics: readonly ProviderCall[];
  readonly stageMetrics: readonly StageRecord[];
  /** A bounded sample of the sidecar log window to include. */
  readonly logSample: readonly string[];
  /** Actual secrets to mask (in addition to the well-known default patterns). */
  readonly secrets: readonly string[];
}

function formatNumber(value: number | null, suffix = "ms"): string {
  return value === null ? "—" : `${Math.round(value)}${suffix}`;
}

const STAGE_NAMES: readonly StageName[] = ["stt", "llm", "tts", "avatar"];

/**
 * Build a redacted, multi-line diagnostic summary. Secrets are redacted before
 * the final string is returned, mirroring `redactDiagnostic` semantics.
 */
export function buildDiagnosticSummary({
  correlationId,
  providerMetrics,
  stageMetrics,
  logSample,
  secrets,
}: DiagnosticSummaryInput): string {
  const provider = summarizeProviderCalls(providerMetrics);

  const lines: string[] = [];
  lines.push("VoxStudio 诊断摘要");
  lines.push("=================");
  lines.push(`关联ID: ${correlationId}`);

  lines.push("");
  lines.push("-- Provider 调用 --");
  lines.push(`总数: ${provider.total}`);
  lines.push(`成功: ${provider.ok}`);
  lines.push(`失败: ${provider.failed}`);
  lines.push(`平均延迟: ${formatNumber(provider.avgLatencyMs)}`);
  lines.push(`P95延迟: ${formatNumber(provider.p95LatencyMs)}`);
  const errorParts = Object.entries(provider.byErrorKind)
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => `${kind}:${count}`);
  lines.push(
    errorParts.length > 0 ? `错误分布: ${errorParts.join(" ")}` : "错误分布: 无",
  );

  lines.push("");
  lines.push("-- 阶段延迟 --");
  for (const stage of STAGE_NAMES) {
    const latency = stageLatency(stageMetrics, stage);
    if (latency.count === 0) {
      continue;
    }
    lines.push(
      `${stage}: 平均 ${formatNumber(latency.avgMs)} / P95 ${formatNumber(
        latency.p95Ms,
      )} / 次数 ${latency.count} / 失败 ${latency.failures}`,
    );
  }

  if (logSample.length > 0) {
    lines.push("");
    lines.push("-- 日志示例 --");
    for (const logLine of logSample) {
      lines.push(`  ${logLine}`);
    }
  }

  lines.push("");
  lines.push("安全说明: 本摘要已自动脱敏，不包含密钥或令牌。");

  // Redact every line (literal secrets + default token patterns) before joining.
  const redacted = redactDiagnostic(lines, secrets);
  return `${redacted.join("\n")}\n`;
}

/** Split a summary string into its individual lines, dropping the trailing empty. */
export function diagnosticSummaryLines(summary: string): string[] {
  return summary.split("\n").filter((line) => line.length > 0);
}