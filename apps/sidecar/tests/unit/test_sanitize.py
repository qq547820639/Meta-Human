import json
import logging

from pydantic import SecretStr

from voxstudio_core.sanitize import (
    REDACTED,
    RedactionLogFilter,
    redact_exception,
    redact_string,
    redact_url,
    redact_value,
)


def test_authorization_bearer_token_is_redacted() -> None:
    secret = "sk-abcdefgh1234567890"
    header = f"Authorization: Bearer {secret}"

    redacted = redact_string(header)

    assert secret not in redacted
    assert REDACTED in redacted
    assert redacted == f"Authorization: Bearer {REDACTED}"


def test_bearer_token_embedded_in_log_line_is_redacted() -> None:
    secret = "sk-abcdefgh1234567890"
    redacted = redact_string(f"calling provider with Bearer {secret} now")

    assert secret not in redacted
    assert f"Bearer {REDACTED}" in redacted


def test_api_key_headers_are_redacted() -> None:
    secret = "K7x9q2mZ4nW8vL1pW3rT6yU"
    for header_name in ("Api-Key", "X-Api-Key", "X-Auth-Token"):
        redacted = redact_string(f"{header_name}: {secret}")
        assert secret not in redacted
        assert REDACTED in redacted


def test_basic_authorization_value_is_redacted() -> None:
    secret = "dXNlcjpwYXNzd29yZA=="
    redacted = redact_string(f"Authorization: Basic {secret}")

    assert secret not in redacted
    assert REDACTED in redacted


def test_standalone_sk_api_key_is_redacted() -> None:
    secret = "sk-abcdefghijklmnopqrstuvwxyz123456"
    redacted = redact_string(f"openai key is {secret}")

    assert secret not in redacted
    assert "sk-[REDACTED]" in redacted


def test_url_query_parameter_secrets_are_redacted() -> None:
    url = "https://api.example.com/v1/models?api_key=super-secret-123&page=2"
    redacted = redact_url(url)

    assert "api_key=super-secret-123" not in redacted
    assert "api_key=[REDACTED]" in redacted
    assert "page=2" in redacted


def test_url_preserves_non_sensitive_parameters() -> None:
    url = "https://api.example.com/search?q=hello&access_token=abc-123&limit=10"
    redacted = redact_url(url)

    assert "access_token=abc-123" not in redacted
    assert "access_token=[REDACTED]" in redacted
    assert "q=hello" in redacted
    assert "limit=10" in redacted


def test_url_without_query_is_returned_unchanged() -> None:
    url = "https://api.example.com/v1/models"
    assert redact_url(url) == url


def test_exception_message_with_secret_is_masked() -> None:
    secret = "sk-extremely-secret-api-key-0001"
    error = RuntimeError(f"provider rejected bearer {secret} token")

    rendered = redact_exception(error)

    assert secret not in rendered
    assert REDACTED in rendered
    assert type(error).__name__ in rendered


def test_exception_with_traceback_has_secrets_masked() -> None:
    secret = "Bearer sk-traceback-secret-0002"
    try:
        raise ValueError(f"boom {secret}")
    except ValueError as error:
        err = error

    rendered = redact_exception(err)

    assert "sk-traceback-secret-0002" not in rendered
    assert REDACTED in rendered


def test_secret_str_never_leaks_through_repr_or_str() -> None:
    secret = SecretStr("s3cr3t-value-0003")

    assert "s3cr3t-value-0003" not in repr(secret)
    assert "s3cr3t-value-0003" not in str(secret)


def test_secret_str_is_redacted_by_redact_value() -> None:
    secret = SecretStr("s3cr3t-value-0004")

    assert redact_value(secret) == REDACTED


def test_diagnostic_export_does_not_leak_credentials() -> None:
    secret = "sk-diag-secret-0005"
    payload = {
        "request": {
            "url": f"https://api.example.com?api_key={secret}",
            "headers": {"Authorization": f"Bearer {secret}"},
        },
        "error": {"message": f"failed with token {secret}", "code": "E1"},
        "config": SecretStr("another-secret-value"),
        "nested": {"list": [f"token={secret}", "safe"]},
    }

    redacted = redact_value(payload)
    serialized = json.dumps(redacted)

    assert secret not in serialized
    assert "another-secret-value" not in serialized
    assert REDACTED in serialized
    assert "safe" in serialized
    assert "E1" in serialized


def test_logging_filter_redacts_message() -> None:
    record = logging.LogRecord(
        name="test.sanitize",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg="Authorization: Bearer sk-top-secret-token-0006",
        args=None,
        exc_info=None,
    )

    RedactionLogFilter().filter(record)

    formatted = record.getMessage()
    assert "sk-top-secret-token-0006" not in formatted
    assert REDACTED in formatted


def test_logging_filter_redacts_structured_args() -> None:
    secret = "sk-args-secret-token-0007"
    record = logging.LogRecord(
        name="test.sanitize",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg="using token %(token)s on page %(page)s",
        args={"token": secret, "page": "1"},
        exc_info=None,
    )

    RedactionLogFilter().filter(record)

    formatted = record.getMessage()
    assert secret not in formatted
    assert REDACTED in formatted
    assert "page 1" in formatted
