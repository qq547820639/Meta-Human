import pytest
from pydantic import ValidationError

from voxstudio_core.providers.local_config import LocalProviderConfig


def test_defaults_use_loopback_base_url_and_bounded_timeout() -> None:
    config = LocalProviderConfig(
        base_url="http://127.0.0.1:11434",
        chat_model="local-chat",
        embedding_model="local-embed",
    )

    assert config.base_url == "http://127.0.0.1:11434"
    assert config.timeout_seconds == 5.0
    assert config.max_sample_bytes == 10_485_760
    assert config.allow_remote is False


@pytest.mark.parametrize("url", ("http://127.0.0.1:11434", "http://localhost:11434"))
def test_localhost_and_loopback_urls_are_accepted(url: str) -> None:
    config = LocalProviderConfig(
        base_url=url,
        chat_model="chat",
        embedding_model="embed",
    )

    assert config.base_url == url


def test_trailing_slash_is_normalized() -> None:
    config = LocalProviderConfig(
        base_url="http://127.0.0.1:11434/",
        chat_model="chat",
        embedding_model="embed",
    )

    assert config.base_url == "http://127.0.0.1:11434"


@pytest.mark.parametrize(
    "url",
    (
        "ftp://127.0.0.1:11434",
        "not a url",
        "http://",
        "https://user:pass@127.0.0.1:11434",
    ),
)
def test_invalid_base_urls_are_rejected(url: str) -> None:
    with pytest.raises(ValidationError):
        LocalProviderConfig(
            base_url=url,
            chat_model="chat",
            embedding_model="embed",
        )


def test_non_loopback_url_requires_remote_opt_in() -> None:
    with pytest.raises(ValidationError, match="loopback"):
        LocalProviderConfig(
            base_url="http://10.0.0.8:11434",
            chat_model="chat",
            embedding_model="embed",
        )

    config = LocalProviderConfig(
        base_url="http://10.0.0.8:11434",
        chat_model="chat",
        embedding_model="embed",
        allow_remote=True,
    )

    assert config.base_url == "http://10.0.0.8:11434"


@pytest.mark.parametrize("timeout", (0, -1, 61))
def test_timeout_must_be_positive_and_bounded(timeout: float) -> None:
    with pytest.raises(ValidationError):
        LocalProviderConfig(
            base_url="http://127.0.0.1:11434",
            chat_model="chat",
            embedding_model="embed",
            timeout_seconds=timeout,
        )
