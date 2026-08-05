import ipaddress
import re
import secrets
from typing import NoReturn, SupportsIndex

from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator

STARTUP_TOKEN_BYTES = 32
MIN_STARTUP_TOKEN_LENGTH = 43
_BEARER_TOKEN_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")


def generate_startup_token() -> str:
    return secrets.token_urlsafe(STARTUP_TOKEN_BYTES)


def validate_startup_token(token: str) -> str:
    if len(token) < MIN_STARTUP_TOKEN_LENGTH:
        raise ValueError("startup bearer token is too short")
    if _BEARER_TOKEN_PATTERN.fullmatch(token) is None:
        raise ValueError("startup bearer token contains invalid characters")
    return token


class SidecarConfig(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        frozen=True,
        hide_input_in_errors=True,
    )

    host: str = "127.0.0.1"
    port: int = Field(default=0, ge=0, le=65_535)
    bearer_token: SecretStr = Field(exclude=True, repr=False)

    @field_validator("host")
    @classmethod
    def validate_loopback_host(cls, host: str) -> str:
        normalized = host.strip()
        if normalized.casefold() == "localhost":
            return "localhost"
        if not normalized or "%" in normalized:
            raise ValueError("host must be a literal loopback address or localhost")
        try:
            address = ipaddress.ip_address(normalized)
        except ValueError as error:
            raise ValueError(
                "host must be a literal loopback address or localhost"
            ) from error
        if not address.is_loopback:
            raise ValueError("host must be a loopback address")
        return normalized

    @field_validator("bearer_token")
    @classmethod
    def validate_bearer_token(cls, token: SecretStr) -> SecretStr:
        validate_startup_token(token.get_secret_value())
        return token

    def __reduce_ex__(self, protocol: SupportsIndex) -> NoReturn:
        del protocol
        raise TypeError("SidecarConfig secrets must not be serialized")
