from ipaddress import ip_address
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class LocalProviderConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    allow_remote: bool = False
    base_url: str = Field(default="http://127.0.0.1:11434")
    chat_model: str = Field(min_length=1)
    embedding_model: str = Field(min_length=1)
    stt_model: str | None = None
    timeout_seconds: float = Field(default=5.0, gt=0, le=60)
    max_sample_bytes: int = Field(default=10_485_760, gt=0)

    @field_validator("base_url")
    @classmethod
    def normalize_base_url(cls, value: str) -> str:
        normalized = value.strip().rstrip("/")
        parsed = urlparse(normalized)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            raise ValueError("base_url must be an http(s) URL")
        if parsed.username is not None or parsed.password is not None:
            raise ValueError("base_url must not contain credentials")
        return normalized

    @model_validator(mode="after")
    def guard_loopback_host(self) -> "LocalProviderConfig":
        if self.allow_remote:
            return self
        host = urlparse(self.base_url).hostname or ""
        if host.casefold() == "localhost":
            return self
        try:
            if ip_address(host).is_loopback:
                return self
        except ValueError:
            pass
        raise ValueError(
            "local base_url must use a loopback host unless allow_remote is true"
        )
