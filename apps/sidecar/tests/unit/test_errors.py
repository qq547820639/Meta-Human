import pytest
from pydantic import ValidationError

from voxstudio_core.errors import (
    ErrorEnvelope,
    new_request_id,
    unexpected_error_envelope,
)


def test_safe_error_envelope_contains_the_required_contract() -> None:
    envelope = ErrorEnvelope(
        code="readiness_unavailable",
        message="Readiness is not available yet.",
        retryable=True,
        request_id="request-123",
    )

    assert envelope.model_dump(exclude_none=True) == {
        "code": "readiness_unavailable",
        "message": "Readiness is not available yet.",
        "retryable": True,
        "request_id": "request-123",
    }


def test_safe_error_envelope_includes_one_optional_recommended_action() -> None:
    envelope = ErrorEnvelope(
        code="microphone_permission_required",
        message="Microphone access is required.",
        retryable=False,
        recommended_action="Allow microphone access in System Settings.",
        request_id="request-456",
    )

    assert envelope.model_dump(exclude_none=True)["recommended_action"] == (
        "Allow microphone access in System Settings."
    )


@pytest.mark.parametrize("field", ("code", "message", "request_id"))
def test_safe_error_envelope_rejects_empty_required_text(field: str) -> None:
    values: dict[str, object] = {
        "code": "internal_error",
        "message": "An error occurred.",
        "retryable": False,
        "request_id": "request-789",
    }
    values[field] = "   "

    with pytest.raises(ValidationError, match=field):
        ErrorEnvelope.model_validate(values)


def test_unexpected_errors_are_replaced_with_a_generic_safe_envelope() -> None:
    secret = "startup-secret-that-must-never-escape"
    error = RuntimeError(
        f"provider failed with {secret}\nTraceback (most recent call last)"
    )

    envelope = unexpected_error_envelope(error, request_id="request-safe")
    serialized = envelope.model_dump_json(exclude_none=True)

    assert envelope == ErrorEnvelope(
        code="internal_error",
        message="An unexpected error occurred.",
        retryable=False,
        request_id="request-safe",
    )
    assert secret not in serialized
    assert "RuntimeError" not in serialized
    assert "Traceback" not in serialized


def test_request_ids_are_opaque_and_unique() -> None:
    first = new_request_id()
    second = new_request_id()

    assert first
    assert second
    assert first != second
