from ipaddress import ip_address
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from voxstudio_core.ssrf import classify_host


def _is_loopback_host(host: str) -> bool:
    if host.casefold() == "localhost":
        return True
    try:
        return ip_address(host).is_loopback
    except ValueError:
        return False


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
        host = urlparse(self.base_url).hostname or ""
        # Loopback is always a valid local-provider target (Ollama etc. run on
        # 127.0.0.1). Determining whether the host is loopback needs the IP form.
        if _is_loopback_host(host):
            return self
        if not self.allow_remote:
            raise ValueError(
                "local base_url must use a loopback host unless allow_remote is true"
            )
        # Remote opt-in still must not dial link-local (cloud metadata),
        # multicast or reserved targets — SSRF protection holds even when the
        # operator explicitly allows remote base URLs.
        classification = classify_host(host)
        if classification in {"link-local", "multicast", "unspecified"}:
            raise ValueError(
                "base_url must not target a link-local, multicast or reserved address"
            )
        return self
