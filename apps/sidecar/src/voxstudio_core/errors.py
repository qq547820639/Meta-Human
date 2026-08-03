import secrets
from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, field_validator


class ErrorEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    code: str
    message: str
    retryable: bool
    recommended_action: str | None = None
    request_id: str
    technical_message: str | None = None
    details: dict[str, Any] | None = None
    provider: str | None = None
    provider_status: str | None = None
    timestamp: str | None = None

    @field_validator("code", "message", "request_id")
    @classmethod
    def validate_required_text(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("value must not be empty")
        return normalized

    @field_validator("recommended_action", "technical_message")
    @classmethod
    def validate_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            raise ValueError("value must not be empty")
        return normalized


# Error categories shared across the API. Codes are machine-readable and map
# to a recommended user action.
class ErrorCode:
    INVALID_ARGUMENT = "invalid_argument"
    CONFIG_ERROR = "config_error"
    CREDENTIAL_ERROR = "credential_error"
    PERMISSION_ERROR = "permission_error"
    RESOURCE_NOT_FOUND = "resource_not_found"
    NETWORK_ERROR = "network_error"
    REQUEST_TIMEOUT = "request_timeout"
    PROVIDER_RATE_LIMITED = "provider_rate_limited"
    PROVIDER_BUSY = "provider_busy"
    MODEL_NOT_FOUND = "model_not_found"
    INCOMPATIBLE_RESPONSE = "incompatible_response"
    DATABASE_ERROR = "database_error"
    FILE_IO_ERROR = "file_io_error"
    TASK_CANCELLED = "task_cancelled"
    TASK_STATE_CONFLICT = "task_state_conflict"
    INTERNAL_ERROR = "internal_error"


ACTIONS = {
    ErrorCode.INVALID_ARGUMENT: "请检查输入后重试。",
    ErrorCode.CONFIG_ERROR: "请打开设置检查并修正服务配置。",
    ErrorCode.CREDENTIAL_ERROR: "请重新授权或更新凭证。",
    ErrorCode.PERMISSION_ERROR: "请检查权限或联系管理员。",
    ErrorCode.RESOURCE_NOT_FOUND: "请创建或确认该资源存在。",
    ErrorCode.NETWORK_ERROR: "请检查网络连接后重试。",
    ErrorCode.REQUEST_TIMEOUT: "请稍后重试。",
    ErrorCode.PROVIDER_RATE_LIMITED: "请稍后重试，或降低请求频率。",
    ErrorCode.PROVIDER_BUSY: "服务繁忙，请稍后重试。",
    ErrorCode.MODEL_NOT_FOUND: "请检查模型名称是否存在于服务中。",
    ErrorCode.INCOMPATIBLE_RESPONSE: "服务响应格式不兼容，请检查服务版本。",
    ErrorCode.DATABASE_ERROR: "本地存储异常，请重试。",
    ErrorCode.FILE_IO_ERROR: "文件读写失败，请检查文件后重试。",
    ErrorCode.TASK_CANCELLED: "任务已取消。",
    ErrorCode.TASK_STATE_CONFLICT: "任务当前状态不允许该操作。",
    ErrorCode.INTERNAL_ERROR: "发生未知错误，请稍后重试。",
}


def new_request_id() -> str:
    return secrets.token_urlsafe(18)


def utc_timestamp() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds")


def unexpected_error_envelope(
    error: BaseException,
    *,
    request_id: str,
) -> ErrorEnvelope:
    del error
    return ErrorEnvelope(
        code=ErrorCode.INTERNAL_ERROR,
        message="An unexpected error occurred.",
        retryable=False,
        request_id=request_id,
        recommended_action=ACTIONS[ErrorCode.INTERNAL_ERROR],
        timestamp=utc_timestamp(),
    )


def error_envelope(
    *,
    code: str,
    message: str,
    retryable: bool,
    request_id: str,
    recommended_action: str | None = None,
    technical_message: str | None = None,
    details: dict[str, Any] | None = None,
    provider: str | None = None,
    provider_status: str | None = None,
) -> ErrorEnvelope:
    return ErrorEnvelope(
        code=code,
        message=message,
        retryable=retryable,
        request_id=request_id,
        recommended_action=recommended_action or ACTIONS.get(code),
        technical_message=technical_message,
        details=details,
        provider=provider,
        provider_status=provider_status,
        timestamp=utc_timestamp(),
    )