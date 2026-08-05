from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol

import httpx

from voxstudio_core.readiness.models import CapabilityId


@dataclass(frozen=True, slots=True)
class CapabilityCheckRequest:
    capability_id: CapabilityId
    attempt: int


@dataclass(frozen=True, slots=True)
class CapabilityReady:
    safe_detail: str | None = None


@dataclass(frozen=True, slots=True)
class CapabilityTransientFailure:
    code: str
    message: str
    safe_detail: str | None = None


@dataclass(frozen=True, slots=True)
class CapabilityActionRequired:
    code: str
    message: str
    recommended_action: str
    safe_detail: str | None = None

    def __post_init__(self) -> None:
        if not self.recommended_action.strip():
            raise ValueError("recommended_action must not be empty")


type CapabilityCheckOutcome = (
    CapabilityReady | CapabilityTransientFailure | CapabilityActionRequired
)


class CapabilityAdapter(Protocol):
    async def check(
        self,
        request: CapabilityCheckRequest,
    ) -> CapabilityCheckOutcome: ...


_HTML_CONTENT_TYPES = ("text/html", "application/xhtml+xml")


def is_html_content_type(value: str) -> bool:
    """True when a content-type header identifies an HTML document."""
    lower = value.lower()
    return any(lower.startswith(t) for t in _HTML_CONTENT_TYPES)


def _is_json_content_type(value: str) -> bool:
    return "json" in value.lower()


@dataclass(frozen=True, slots=True)
class ResponseValidation:
    """Result of validating an HTTP probe response for a readiness check."""

    ok: bool
    step: str
    code: str
    message: str


class ResponseValidationError(ValueError):
    """Raised when a JSON-capable probe response fails structure validation."""

    def __init__(self, validation: ResponseValidation) -> None:
        self.validation = validation
        super().__init__(validation.message)


def validate_json_response(
    response: httpx.Response,
    *,
    service: str,
    required_fields: Sequence[str] = (),
) -> ResponseValidation:
    """Validate that an HTTP probe answer is a well-formed JSON payload.

    A readiness check must not treat an HTML page, a proxy landing page, an
    empty body or an error envelope as a healthy response.
    """
    if not 200 <= response.status_code < 300:
        return ResponseValidation(
            ok=False,
            step="status",
            code="http_status_error",
            message=(
                f"{service} 返回 HTTP {response.status_code}，接口未正常响应。"
                "请确认服务已启动且地址正确。"
            ),
        )

    content_type = response.headers.get("content-type", "")
    if is_html_content_type(content_type):
        return ResponseValidation(
            ok=False,
            step="content_type",
            code="html_response",
            message=(
                f"{service} 返回的是一个网页（HTML）而不是接口。"
                "请确认地址指向 API 端点，而不是网页或代理登录页。"
            ),
        )
    if content_type and not _is_json_content_type(content_type):
        return ResponseValidation(
            ok=False,
            step="content_type",
            code="non_json_response",
            message=(
                f"{service} 返回了非 JSON 内容，响应结构不符合预期。"
            ),
        )

    if not response.content:
        return ResponseValidation(
            ok=False,
            step="body",
            code="empty_response",
            message=f"{service} 返回了空响应，接口未正常响应。",
        )

    try:
        data = response.json()
    except (TypeError, ValueError):
        return ResponseValidation(
            ok=False,
            step="json",
            code="invalid_json",
            message=(
                f"{service} 返回的内容不是有效的 JSON，接口响应结构不符合预期。"
            ),
        )

    if isinstance(data, dict) and isinstance(data.get("error"), dict):
        detail = data["error"].get("message") or data["error"].get("code")
        if not isinstance(detail, str) or not detail.strip():
            detail = "unknown error"
        return ResponseValidation(
            ok=False,
            step="error_envelope",
            code="provider_error",
            message=f"{service} 返回错误：{detail}。",
        )
    if not isinstance(data, dict):
        return ResponseValidation(
            ok=False,
            step="structure",
            code="invalid_structure",
            message=(
                f"{service} 返回的 JSON 结构不符合预期（应为对象）。"
            ),
        )
    for field in required_fields:
        if field not in data:
            return ResponseValidation(
                ok=False,
                step="structure",
                code="missing_field",
                message=(
                    f"{service} 响应缺少关键字段 {field}，接口结构不符合预期。"
                ),
            )
    return ResponseValidation(ok=True, step="ok", code="", message="")


def validation_failure_outcome(
    validation: ResponseValidation,
    *,
    capability_label: str,
    safe_detail: str,
) -> CapabilityActionRequired:
    """Map a structural validation failure to an actionable capability outcome."""
    return CapabilityActionRequired(
        code=validation.code,
        message=validation.message,
        recommended_action=(
            f"请检查{capability_label}的服务地址与接口路径后重试。"
        ),
        safe_detail=safe_detail,
    )
