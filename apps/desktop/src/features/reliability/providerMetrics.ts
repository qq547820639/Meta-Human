/**
 * Provider call timing & error classification.
 *
 * Records how long each provider call took, whether it succeeded, and why it
 * failed. The classification is a pure heuristic over the error's message /
 * HTTP status / content so a single call site can map any thrown error to one
 * of a small set of machine-consumable kinds used by retry/backoff and the
 * diagnostic summary.
 *
 * No network, no timers, no browser APIs.
 */

export type ProviderErrorKind =
  | "timeout"
  | "auth"
  | "rate_limit"
  | "network"
  | "server"
  | "unknown";

export interface ProviderCall {
  readonly provider: string;
  readonly operation: string;
  readonly startedAtMs: number;
  readonly finishedAtMs: number;
  readonly ok: boolean;
  /** Present only when `ok` is false. */
  readonly errorKind: ProviderErrorKind | null;
}

/** Append a call, returning a new array (immutable-update style). */
export function recordProviderCall(
  calls: readonly ProviderCall[],
  call: ProviderCall,
): ProviderCall[] {
  return [...calls, call];
}

/** Keep only calls whose start time falls inside [startMs, endMs]. */
export function sliceToWindow(
  calls: readonly ProviderCall[],
  startMs: number,
  endMs: number,
): ProviderCall[] {
  return calls.filter(
    (call) => call.startedAtMs >= startMs && call.startedAtMs <= endMs,
  );
}

function messageOf(err: unknown): string {
  if (typeof err === "string") {
    return err;
  }
  if (err && typeof err === "object") {
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string") {
      return message;
    }
    const data = (err as { data?: unknown }).data;
    if (data && typeof data === "object") {
      const nested = (data as { message?: unknown }).message;
      if (typeof nested === "string") {
        return nested;
      }
    }
  }
  return "";
}

function statusOf(err: unknown): number | null {
  if (err && typeof err === "object") {
    const status =
      (err as { status?: unknown }).status ??
      (err as { statusCode?: unknown }).statusCode;
    if (typeof status === "number") {
      return status;
    }
  }
  return null;
}

function nameOf(err: unknown): string {
  if (err && typeof err === "object") {
    const name = (err as { name?: unknown }).name;
    return typeof name === "string" ? name : "";
  }
  return "";
}

/**
 * Classify an arbitrary thrown value into a `ProviderErrorKind` using a
 * heuristic over its message, HTTP status and error name. Order matters:
 * status codes are authoritative when present; otherwise message / name
 * keywords are matched. Anything unrecognized is `unknown`.
 */
export function classifyProviderError(err: unknown): ProviderErrorKind {
  const message = messageOf(err).toLowerCase();
  const name = nameOf(err).toLowerCase();
  const status = statusOf(err);

  if (status !== null) {
    if (status === 401 || status === 403) {
      return "auth";
    }
    if (status === 408 || status === 504) {
      return "timeout";
    }
    if (status === 429) {
      return "rate_limit";
    }
    if (status >= 500) {
      return "server";
    }
  }

  const combined = `${name} ${message}`;

  if (
    combined.includes("timeout") ||
    combined.includes("timed out") ||
    combined.includes("etimedout") ||
    combined.includes("deadline exceeded") ||
    name === "timeouterror"
  ) {
    return "timeout";
  }
  if (
    combined.includes("unauthorized") ||
    combined.includes("forbidden") ||
    combined.includes("invalid api key") ||
    combined.includes("permission denied") ||
    combined.includes("401") ||
    combined.includes("403")
  ) {
    return "auth";
  }
  if (
    combined.includes("rate limit") ||
    combined.includes("quota") ||
    combined.includes("too many requests") ||
    combined.includes("throttl")
  ) {
    return "rate_limit";
  }
  if (
    combined.includes("network") ||
    combined.includes("econnrefused") ||
    combined.includes("socket") ||
    combined.includes("fetch failed") ||
    combined.includes("enotfound") ||
    combined.includes("connection")
  ) {
    return "network";
  }
  if (
    combined.includes("500") ||
    combined.includes("internal server error") ||
    combined.includes("server error") ||
    combined.includes("5")
  ) {
    return "server";
  }

  return "unknown";
}

export interface ProviderSummary {
  readonly total: number;
  readonly ok: number;
  readonly failed: number;
  readonly avgLatencyMs: number | null;
  readonly p95LatencyMs: number | null;
  readonly byErrorKind: Record<ProviderErrorKind, number>;
}

const ALL_ERROR_KINDS: readonly ProviderErrorKind[] = [
  "timeout",
  "auth",
  "rate_limit",
  "network",
  "server",
  "unknown",
];

function emptyKindCounts(): Record<ProviderErrorKind, number> {
  return {
    timeout: 0,
    auth: 0,
    rate_limit: 0,
    network: 0,
    server: 0,
    unknown: 0,
  };
}

/** Nearest-rank percentile over a sorted list of latencies. */
function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[index];
}

/**
 * Aggregate a set of calls into a summary: totals, average latency, P95 latency
 * (nearest-rank) and a per-kind error breakdown. Empty input yields
 * `null` latencies and all-zero counts.
 */
export function summarizeProviderCalls(
  calls: readonly ProviderCall[],
): ProviderSummary {
  const byErrorKind = emptyKindCounts();
  let ok = 0;
  let failed = 0;
  let totalLatency = 0;

  for (const call of calls) {
    totalLatency += call.finishedAtMs - call.startedAtMs;
    if (call.ok) {
      ok += 1;
    } else {
      failed += 1;
      const kind = call.errorKind ?? "unknown";
      byErrorKind[kind] += 1;
    }
  }

  const total = calls.length;
  const latencies = calls
    .map((call) => call.finishedAtMs - call.startedAtMs)
    .sort((a, b) => a - b);

  return {
    total,
    ok,
    failed,
    avgLatencyMs: total === 0 ? null : totalLatency / total,
    p95LatencyMs: total === 0 ? null : percentile(latencies, 95),
    byErrorKind,
  };
}

/** Re-exported so consumers can iterate error kinds without importing the const. */
export const PROVIDER_ERROR_KINDS = ALL_ERROR_KINDS;