"""Unit tests for the provider metrics counters and aggregation."""

from voxstudio_core.metrics import (
    OUTCOME_CANCELLED,
    OUTCOME_DEGRADED,
    OUTCOME_ERROR,
    OUTCOME_SUCCESS,
    ProviderMetrics,
    ProviderMetricsRegistry,
)


def test_provider_metrics_aggregate_rates_and_latency() -> None:
    metrics = ProviderMetrics()
    metrics.record(OUTCOME_SUCCESS, 10.0)
    metrics.record(OUTCOME_SUCCESS, 30.0)
    metrics.record(OUTCOME_ERROR, 20.0)
    metrics.record(OUTCOME_CANCELLED, 5.0)
    metrics.record(OUTCOME_DEGRADED, 15.0)

    snapshot = metrics.snapshot(provider="llm_chat")

    assert snapshot["provider"] == "llm_chat"
    assert snapshot["total"] == 5
    assert snapshot["success"] == 2
    assert snapshot["error"] == 1
    assert snapshot["cancelled"] == 1
    assert snapshot["degraded"] == 1
    assert snapshot["error_rate"] == 0.2
    assert snapshot["cancel_rate"] == 0.2
    assert snapshot["degraded_rate"] == 0.2
    assert snapshot["avg_latency_ms"] == 16.0
    assert snapshot["p95_latency_ms"] == 30.0


def test_provider_metrics_empty_snapshot_has_zero_rates_and_null_latency() -> None:
    snapshot = ProviderMetrics().snapshot(provider="tts_synthesize")

    assert snapshot["total"] == 0
    assert snapshot["error_rate"] == 0.0
    assert snapshot["cancel_rate"] == 0.0
    assert snapshot["degraded_rate"] == 0.0
    assert snapshot["avg_latency_ms"] is None
    assert snapshot["p95_latency_ms"] is None


def test_provider_metrics_rejects_unknown_outcome() -> None:
    metrics = ProviderMetrics()
    try:
        metrics.record("bogus", 1.0)
    except ValueError:
        pass
    else:
        raise AssertionError("expected ValueError for unknown outcome")


def test_registry_keeps_providers_separate_and_bounds_latency_sample() -> None:
    registry = ProviderMetricsRegistry()
    registry.record("llm_chat", OUTCOME_SUCCESS, 1.0)
    registry.record("tts_synthesize", OUTCOME_ERROR, 2.0)

    snapshot = registry.snapshot()
    assert snapshot["total_calls"] == 2
    assert snapshot["total_error_rate"] == 0.5
    assert snapshot["total_cancel_rate"] == 0.0
    assert {row["provider"] for row in snapshot["providers"]} == {
        "llm_chat",
        "tts_synthesize",
    }

    registry.reset()
    assert registry.snapshot()["total_calls"] == 0


def test_registry_snapshot_never_contains_user_content() -> None:
    registry = ProviderMetricsRegistry()
    registry.record("llm_chat", OUTCOME_SUCCESS, 5.0)

    snapshot = registry.snapshot()
    dumped = str(snapshot)
    assert "conversation" not in dumped
    assert "transcript" not in dumped
    assert "prompt" not in dumped
    assert "token" not in dumped
    assert "secret" not in dumped