"""Secret desensitization (redaction) helpers.

Guarantees that logs, error messages and diagnostic exports never carry raw
API keys, tokens or other credentials.  Every function in this module is pure
and safe to call anywhere an untrusted string or exception needs to be rendered
for humans or persisted to disk.
"""

from __future__ import annotations

import logging
import re
import traceback
from typing import Any
from urllib.parse import urlsplit, urlunsplit

from pydantic import SecretStr

REDACTED = "[REDACTED]"

# Sensitive query/form/assignment parameter names.  Matching is case-insensitive
# and tolerates ``-``/``_``/space as a separator (e.g. ``api_key``, ``api-key``,
# ``api key`` all match).
_SENSITIVE_PARAM_NAMES = {
    "access_key",
    "access_token",
    "api_key",
    "apikey",
    "auth",
    "auth_token",
    "authorization",
    "client_id",
    "client_secret",
    "passwd",
    "password",
    "pwd",
    "refresh_token",
    "secret",
    "secret_key",
    "session_token",
    "sig",
    "sign",
    "signature",
    "token",
    "x_api_key",
    "x_apikey",
    "x_auth_token",
    "x_access_token",
}


def _name_pattern(name: str) -> str:
    return r"[-_ ]?".join(re.escape(part) for part in name.split("_"))


_NAMES_ALT = "|".join(
    _name_pattern(name)
    for name in sorted(_SENSITIVE_PARAM_NAMES, key=len, reverse=True)
)

# ``Authorization: Bearer <token>`` / ``Bearer sk-...`` anywhere in text.
_BEARER_PATTERN = re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._~+/=-]+")
# ``Authorization: Basic <base64>``.
_BASIC_PATTERN = re.compile(r"(?i)\bBasic\s+[A-Za-z0-9+/=]+")
# Standalone OpenAI-style ``sk-...`` keys not already covered by Bearer.
_SK_PATTERN = re.compile(r"\bsk-[A-Za-z0-9_-]{8,}")
# Credential headers without a Bearer/Basic scheme.
_CREDENTIAL_HEADER_PATTERN = re.compile(
    r"(?i)\b(Authorization|Proxy-Authorization|Api[-_ ]?Key|"
    r"X[-_ ]?Api[-_ ]?Key|X[-_ ]?Auth[-_ ]?Token)\s*:\s*"
    r"(?!\s*(?:Bearer|Basic)\b)[^\r\n]+"
)
# ``<sensitive-name>=<value>`` assignments (query strings, form data, configs).
_ASSIGNMENT_PATTERN = re.compile(
    rf"(?i)\b({_NAMES_ALT})[ \t]*=[ \t]*([^\s;&,;\"']+)"
)


def redact_string(text: str) -> str:
    """Mask every known secret pattern found in ``text``.

    Recognizes bearer/basic authorization values, ``sk-...`` API keys,
    credential headers (``Api-Key``, ``Authorization``, ``X-Api-Key``, ...) and
    ``name=value`` assignments whose name is sensitive.
    """
    if not text:
        return text
    result = _BEARER_PATTERN.sub(f"Bearer {REDACTED}", text)
    result = _BASIC_PATTERN.sub(f"Basic {REDACTED}", result)
    result = _SK_PATTERN.sub("sk-[REDACTED]", result)
    result = _CREDENTIAL_HEADER_PATTERN.sub(
        lambda match: f"{match.group(1)}: {REDACTED}",
        result,
    )
    result = _ASSIGNMENT_PATTERN.sub(
        lambda match: f"{match.group(1)}={REDACTED}",
        result,
    )
    return result


def redact_url(url: str) -> str:
    """Redact sensitive query parameters from ``url`` while keeping the rest.

    Only parameter names considered sensitive are masked; all other query
    parameters and the URL structure are preserved verbatim.
    """
    try:
        parsed = urlsplit(url)
    except ValueError:
        return redact_string(url)
    if not parsed.query:
        return url
    redacted_query = "&".join(
        _redact_query_pair(pair) for pair in parsed.query.split("&") if pair
    )
    return urlunsplit(parsed._replace(query=redacted_query))


def _redact_query_pair(pair: str) -> str:
    name, separator, value = pair.partition("=")
    if separator and _is_sensitive_name(name):
        return f"{name}={REDACTED}"
    return pair


def _is_sensitive_name(name: str) -> bool:
    normalized = name.casefold().replace("-", "_").replace("+", " ").strip()
    return normalized in _SENSITIVE_PARAM_NAMES


def redact_exception(error: BaseException) -> str:
    """Render ``error`` (including its traceback) with secrets masked."""
    rendered = "".join(
        traceback.format_exception(type(error), error, error.__traceback__)
    )
    return redact_string(rendered)


_STRING_TYPES = (str,)


def redact_value(value: Any) -> Any:
    """Recursively redact a value, structure or error object.

    ``SecretStr`` instances are replaced with :data:`REDACTED`; strings are run
    through :func:`redact_string`.  Dicts, lists and tuples are traversed.  All
    other objects are returned unchanged.  Suitable for sanitizing a diagnostic
    export payload before it is logged or serialized.
    """
    if isinstance(value, SecretStr):
        return REDACTED
    if isinstance(value, _STRING_TYPES):
        return redact_string(value)
    if isinstance(value, dict):
        return {key: redact_value(item) for key, item in value.items()}
    if isinstance(value, list):
        return [redact_value(item) for item in value]
    if isinstance(value, tuple):
        return tuple(redact_value(item) for item in value)
    return value


class RedactionLogFilter(logging.Filter):
    """Mask secrets in every log record before it is formatted.

    Redacts the record message and any ``%``-style arguments (including structured
    ``extra``-as-args dicts) so that raw credentials never reach a handler.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.msg, str):
            record.msg = redact_string(record.msg)
        if record.args:
            record.args = _redact_log_args(record.args)
        return True


def _redact_log_args(args: Any) -> Any:
    if isinstance(args, dict):
        return {key: redact_value(item) for key, item in args.items()}
    if isinstance(args, tuple):
        return tuple(redact_value(item) for item in args)
    return args


_redaction_filter_installed = False


def install_redaction_filter() -> None:
    """Attach :class:`RedactionLogFilter` to the root logger once.

    Idempotent, so it is safe to call from multiple startup paths.
    """
    global _redaction_filter_installed
    if _redaction_filter_installed:
        return
    logging.getLogger().addFilter(RedactionLogFilter())
    _redaction_filter_installed = True
