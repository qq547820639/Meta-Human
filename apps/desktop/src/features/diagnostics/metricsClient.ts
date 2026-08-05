import { apiRequest } from "../../api/client";

/**
 * Provider observability metrics from the sidecar `/v1/metrics/providers`
 * endpoint. Contains only aggregate counts and latency statistics — never
 * transcripts, prompts, configuration, or user content.
 */
export interface ProviderMetrics {
  readonly provider: string;
  readonly total: number;
  readonly success: number;
  readonly error: number;
  readonly cancelled: number;
  readonly degraded: number;
  readonly error_rate: number;
  readonly cancel_rate: number;
  readonly degraded_rate: number;
  readonly avg_latency_ms: number | null;
  readonly p95_latency_ms: number | null;
}

export interface ProviderMetricsSummary {
  readonly providers: readonly ProviderMetrics[];
  readonly total_calls: number;
  readonly total_error_rate: number;
  readonly total_cancel_rate: number;
  readonly total_degraded_rate: number;
}

export function getProviderMetrics(): Promise<ProviderMetricsSummary> {
  return apiRequest<ProviderMetricsSummary>({
    method: "GET",
    path: "/v1/metrics/providers",
  });
}

/** Compact human-readable label summarising a provider's health. */
export function formatProviderHealth(metrics: ProviderMetrics): string {
  const parts: string[] = [];
  parts.push(`调用 ${metrics.total}`);
  if (metrics.avg_latency_ms !== null) {
    parts.push(`平均 ${Math.round(metrics.avg_latency_ms)}ms`);
  }
  if (metrics.p95_latency_ms !== null) {
    parts.push(`P95 ${Math.round(metrics.p95_latency_ms)}ms`);
  }
  if (metrics.error_rate > 0) {
    parts.push(`错误 ${Math.round(metrics.error_rate * 100)}%`);
  }
  if (metrics.cancel_rate > 0) {
    parts.push(`取消 ${Math.round(metrics.cancel_rate * 100)}%`);
  }
  if (metrics.degraded_rate > 0) {
    parts.push(`降级 ${Math.round(metrics.degraded_rate * 100)}%`);
  }
  return parts.join(" · ");
}