"""SSRF policy unit tests.

Covers the outbound-target classifier and validator used by the provider
clients. The policy must reject loopback / link-local (incl. cloud metadata) /
multicast / reserved targets while allowing public and private RFC1918 hosts.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from voxstudio_core.providers.local_config import LocalProviderConfig
from voxstudio_core.providers.remote_gpu import RemoteGpuConfig
from voxstudio_core.ssrf import (
    classify_host,
    is_denied_remote_target,
    validate_remote_base_url,
)


def test_classify_host_distinguishes_denied_from_allowed() -> None:
    assert classify_host("127.0.0.1") == "loopback"
    assert classify_host("::1") == "loopback"
    assert classify_host("169.254.169.254") == "link-local"
    assert classify_host("fe80::1") == "link-local"
    assert classify_host("224.0.0.1") == "multicast"
    assert classify_host("0.0.0.0") == "unspecified"
    assert classify_host("8.8.8.8") == "global"
    assert classify_host("10.0.0.8") == "global"
    assert classify_host("192.168.1.1") == "global"
    assert classify_host("gpu.example.com") == "hostname"
    assert classify_host("localhost") == "loopback"
    assert classify_host("metadata.google.internal") == "loopback"


@pytest.mark.parametrize(
    "host",
    (
        "127.0.0.1",
        "::1",
        "169.254.169.254",
        "fe80::1",
        "224.0.0.1",
        "0.0.0.0",
        "localhost",
        "metadata.google.internal",
        "instance-data",
    ),
)
def test_denied_remote_targets(host: str) -> None:
    assert is_denied_remote_target(host) is True


@pytest.mark.parametrize(
    "host",
    (
        "8.8.8.8",
        "10.0.0.8",
        "172.16.1.1",
        "192.168.1.1",
        "gpu.example.com",
        "open.feishu.cn",
    ),
)
def test_allowed_remote_targets(host: str) -> None:
    assert is_denied_remote_target(host) is False


def test_validate_remote_base_url_rejects_denied_targets() -> None:
    for url in (
        "http://127.0.0.1:11434",
        "http://169.254.169.254/latest/meta-data",
        "http://0.0.0.0/",
        "http://metadata.google.internal/",
    ):
        with pytest.raises(ValueError):
            validate_remote_base_url(url)


def test_validate_remote_base_url_allows_loopback_when_flagged() -> None:
    assert (
        validate_remote_base_url("http://127.0.0.1:11434", allow_loopback=True)
        == "http://127.0.0.1:11434"
    )


def test_validate_remote_base_url_accepts_public_and_private() -> None:
    assert (
        validate_remote_base_url("https://gpu.example.com") == "https://gpu.example.com"
    )
    assert validate_remote_base_url("http://10.0.0.8:11434") == "http://10.0.0.8:11434"


def test_remote_gpu_config_rejects_cloud_metadata_and_loopback() -> None:
    for url in (
        "http://169.254.169.254/",
        "http://127.0.0.1:8000",
        "http://127.42.18.9:8000",
    ):
        with pytest.raises(ValidationError, match="must not target"):
            RemoteGpuConfig(base_url=url)


def test_remote_gpu_config_still_accepts_private_lan_hosts() -> None:
    config = RemoteGpuConfig(base_url="http://10.0.0.8:8000")
    assert config.base_url == "http://10.0.0.8:8000"


def test_local_config_remote_opt_in_still_denies_metadata() -> None:
    with pytest.raises(ValidationError, match="must not target"):
        LocalProviderConfig(
            base_url="http://169.254.169.254/",
            chat_model="chat",
            embedding_model="embed",
            allow_remote=True,
        )


def test_local_config_remote_opt_in_allows_private_lan_hosts() -> None:
    config = LocalProviderConfig(
        base_url="http://10.0.0.8:11434",
        chat_model="chat",
        embedding_model="embed",
        allow_remote=True,
    )
    assert config.base_url == "http://10.0.0.8:11434"
