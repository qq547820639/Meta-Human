import secrets

from pydantic import BaseModel, ConfigDict, field_validator


class ErrorEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    code: str
    message: str
    retryable: bool
    recommended_action: str | None = None
    request_id: str

    @field_validator("code", "message", "request_id")
    @classmethod
    def validate_required_text(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("value must not be empty")
        return normalized

    @field_validator("recommended_action")
    @classmethod
    def validate_recommended_action(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            raise ValueError("recommended_action must not be empty")
        return normalized


def new_request_id() -> str:
    return secrets.token_urlsafe(18)


def unexpected_error_envelope(
    error: BaseException,
    *,
    request_id: str,
) -> ErrorEnvelope:
    del error
    return ErrorEnvelope(
        code="internal_error",
        message="An unexpected error occurred.",
        retryable=False,
        request_id=request_id,
    )
