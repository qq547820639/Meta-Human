"""Observable provider metrics.

Small, thread-safe counters that track provider latency, error rate, cancel
rate and degradation rate. Metrics are aggregated per provider and exposed via
``/v1/metrics/providers``. Only aggregate counts and latency statistics are
stored -- never user content, prompts, transcripts or configuration details --
so the metrics endpoint is safe to expose and respects privacy by default.
"""

from __future__ import annotations

import threading
import time
from collections import OrderedDict
from statistics import fmean, median
from typing import cast

# Outcome kinds recorded for each provider call.
OUTCOME_SUCCESS = "success"
OUTCOME_ERROR = "error"
OUTCOME_CANCELLED = "cancelled"
OUTCOME_DEGRADED = "degraded"

_VALID_OUTCOMES = frozenset(
    (OUTCOME_SUCCESS, OUTCOME_ERROR, OUTCOME_CANCELLED, OUTCOME_DEGRADED)
)

# Cap the latency sample per provider so memory stays bounded no matter how
# many calls are observed.
_MAX_LATENCY_SAMPLES = 1024


class ProviderMetrics:
    """Per-provider counters and bounded latency sample."""

    __slots__ = (
        "_lock",
        "_total",
        "_success",
        "_error",
        "_cancelled",
        "_degraded",
        "_latencies_ms",
    )

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._total = 0
        self._success = 0
        self._error = 0
        self._cancelled = 0
        self._degraded = 0
        self._latencies_ms: list[float] = []

    def record(self, outcome: str, latency_ms: float) -> None:
        if outcome not in _VALID_OUTCOMES:
            raise ValueError(f"unknown provider outcome: {outcome}")
        with self._lock:
            self._total += 1
            if outcome == OUTCOME_SUCCESS:
                self._success += 1
            elif outcome == OUTCOME_ERROR:
                self._error += 1
            elif outcome == OUTCOME_CANCELLED:
                self._cancelled += 1
            else:
                self._degraded += 1
            self._latencies_ms.append(latency_ms)
            if len(self._latencies_ms) > _MAX_LATENCY_SAMPLES:
                self._latencies_ms = self._latencies_ms[-_MAX_LATENCY_SAMPLES:]

    def snapshot(self, *, provider: str) -> dict[str, object]:
        with self._lock:
            total = self._total
            success = self._success
            error = self._error
            cancelled = self._cancelled
            degraded = self._degraded
            latencies_ms = list(self._latencies_ms)

        def rate(count: int) -> float:
            return round(count / total, 4) if total else 0.0

        return {
            "provider": provider,
            "total": total,
            "success": success,
            "error": error,
            "cancelled": cancelled,
            "degraded": degraded,
            "error_rate": rate(error),
            "cancel_rate": rate(cancelled),
            "degraded_rate": rate(degraded),
            "avg_latency_ms": round(fmean(latencies_ms), 2) if latencies_ms else None,
            "p95_latency_ms": _p95(latencies_ms),
        }


def _p95(latencies_ms: list[float]) -> float | None:
    if not latencies_ms:
        return None
    ordered = sorted(latencies_ms)
    index = max(0, min(len(ordered) - 1, round(len(ordered) * 0.95) - 1))
    return round(ordered[index], 2)


class ProviderMetricsRegistry:
    """Thread-safe collection of per-provider metric counters."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._per_provider: OrderedDict[str, ProviderMetrics] = OrderedDict()

    def record(self, provider: str, outcome: str, latency_ms: float) -> None:
        with self._lock:
            metrics = self._per_provider.get(provider)
            if metrics is None:
                metrics = ProviderMetrics()
                self._per_provider[provider] = metrics
        metrics.record(outcome, latency_ms)

    def snapshot(self) -> dict[str, object]:
        with self._lock:
            providers = list(self._per_provider.items())
        rows = [
            metrics.snapshot(provider=provider)
            for provider, metrics in providers
        ]
        total_calls = sum(cast(int, row["total"]) for row in rows)

        def total_rate(key: str) -> float:
            numerator = sum(cast(int, row[key]) for row in rows)
            return round(numerator / total_calls, 4) if total_calls else 0.0

        return {
            "providers": rows,
            "total_calls": total_calls,
            "total_error_rate": total_rate("error"),
            "total_cancel_rate": total_rate("cancelled"),
            "total_degraded_rate": total_rate("degraded"),
        }

    def reset(self) -> None:
        with self._lock:
            self._per_provider.clear()


# Module-level default registry used by the readiness service and the metrics
# route. The sidecar is a single-process loopback app, so a process-wide
# registry is the observable source of truth.
registry = ProviderMetricsRegistry()


def record_provider_metric(
    provider: str,
    outcome: str,
    *,
    started_at: float | None = None,
) -> None:
    """Record a provider call into the default registry.

    ``started_at`` is a ``time.monotonic()`` timestamp; when omitted a zero
    latency is recorded (useful for unit tests that do not measure timing).
    """
    latency_ms = (time.monotonic() - started_at) * 1000.0 if started_at else 0.0
    registry.record(provider, outcome, latency_ms)


def median_latency_ms(values: list[float]) -> float:
    """Helper kept for symmetry with the latency aggregation primitives."""
    return round(median(values), 2) if values else 0.0
