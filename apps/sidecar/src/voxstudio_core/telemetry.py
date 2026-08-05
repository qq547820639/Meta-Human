"""Structured request telemetry for the sidecar.

Establishes a per-request ``request_id`` that is propagated through the whole
request lifecycle so that logs, errors and response headers can be tied back to
a single request chain. The id is injected into every log record emitted while
the request's async context is active, so a single ``request_id`` lets an
operator correlate every log line belonging to the same request.

Out of scope by design: this module never logs request bodies, query strings,
headers, tokens or any user content. It only carries the opaque request id.
"""

from __future__ import annotations

import logging
import re
from contextvars import ContextVar, Token

_REQUEST_ID: ContextVar[str] = ContextVar("sidecar_request_id", default="")

# Opaque, URL-safe and length-bounded so arbitrary client-supplied values (or
# accidental log injection) cannot be smuggled in as a request id.
_REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{8,128}$")


def current_request_id() -> str:
    """Return the active request id for this async context ("" when none)."""
    return _REQUEST_ID.get()


def set_request_id(request_id: str) -> Token[str]:
    """Bind a request id to the current async context; returns a reset token."""
    return _REQUEST_ID.set(request_id)


def reset_request_id(token: Token[str]) -> None:
    """Unbind the request id using the token returned by :func:`set_request_id`."""
    _REQUEST_ID.reset(token)


def valid_request_id(value: str) -> bool:
    """Return True when ``value`` is a safe, well-formed request id."""
    return bool(_REQUEST_ID_PATTERN.fullmatch(value))


class RequestIdLogFilter(logging.Filter):
    """Attach the active request id to every log record emitted in context."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = current_request_id()
        return True


_request_id_filter_installed = False


def install_request_id_filter() -> None:
    """Attach :class:`RequestIdLogFilter` to the root logger once.

    Idempotent. The filter is safe to install repeatedly; it just adds the
    ``request_id`` attribute to records (empty string when no request is active).
    """
    global _request_id_filter_installed
    if _request_id_filter_installed:
        return
    logging.getLogger().addFilter(RequestIdLogFilter())
    _request_id_filter_installed = True