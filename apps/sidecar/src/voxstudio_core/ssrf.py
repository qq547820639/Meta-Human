"""SSRF-aware outbound URL policy for provider clients.

The sidecar dials user-configured provider endpoints (local OpenAI-compatible
services, remote GPU hosts, Feishu). A malicious or accidental configuration
(SDLC bug, hostile manifest, or a compromised settings value) could otherwise
point the client at loopback services, cloud-metadata (``169.254.169.254``),
link-local or multicast addresses and turn the sidecar into an SSRF proxy that
scans the internal network.

This module provides a small, pure, unit-testable policy that classifies a
host and rejects the targets that are never legitimate for an *outbound remote*
provider: loopback, link-local (including cloud metadata), multicast,
unspecified and broadcast. Private RFC1918 ranges are intentionally permitted
so operators can still point at LAN-hosted services (which the existing local
provider already supports via ``allow_remote``).

The policy operates on *literal* IPs and well-known host aliases. Real DNS
resolution is deliberately not performed here (offline-safe, and it would leak
what hosts the app resolves); the loopback-only default for local providers and
the explicit remote opt-in cover the practical attack surface. Hostnames that
canonically resolve to loopback/link-local are also rejected by name.
"""

from __future__ import annotations

import ipaddress
from urllib.parse import urlparse

# Loopback (IPv4 + IPv6) — a remote provider must never dial the machine itself.
_LOOPBACK_NETWORKS = (
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("::1/128"),
)

# Link-local: 169.254.0.0/16 includes the cloud-metadata endpoint
# 169.254.169.254; fe80::/10 is IPv6 link-local. Both are never valid remote
# provider targets.
_LINK_LOCAL_NETWORKS = (
    ipaddress.ip_network("169.254.0.0/16"),
    ipaddress.ip_network("fe80::/10"),
)

# Multicast and broadcast are never valid unicast provider endpoints.
_MULTICAST_NETWORKS = (
    ipaddress.ip_network("224.0.0.0/4"),
    ipaddress.ip_network("ff00::/8"),
)

# Unspecified / broadcast addresses are never valid targets.
_UNSPECIFIED_NETWORKS = (
    ipaddress.ip_network("0.0.0.0/8"),
    ipaddress.ip_network("::/128"),
)

# Well-known host aliases that resolve to loopback or link-local and are never
# legitimate remote provider targets. Handled by name so configs that use the
# alias (not the literal IP) are still rejected.
_DENIED_HOST_NAMES = frozenset(
    {
        "localhost",
        "localhost.localdomain",
        "localhost6",
        "localhost6.localdomain6",
        # Public cloud metadata endpoints (never valid outbound providers).
        "metadata.google.internal",
        "metadata",
        "169.254.169.254",
        "instance-data",
        "instance-data.ec2.internal",
    }
)


def classify_host(host: str) -> str:
    """Classify a host as ``loopback``, ``link-local``, ``global`` or ``hostname``.

    ``host`` may be a literal IPv4/IPv6 address or a DNS name. Returns:
      - ``"loopback"``   — resolves to a loopback address
      - ``"link-local"`` — resolves to a link-local / cloud-metadata address
      - ``"multicast"``  — a multicast destination
      - ``"unspecified"``— an unspecified or broadcast address
      - ``"global"``     — a public unicast address
      - ``"hostname"``   — a non-IP hostname (policy falls back to name checks)
    """
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        return _classify_hostname(host)
    if any(address in network for network in _LOOPBACK_NETWORKS):
        return "loopback"
    if any(address in network for network in _LINK_LOCAL_NETWORKS):
        return "link-local"
    if any(address in network for network in _MULTICAST_NETWORKS):
        return "multicast"
    if any(address in network for network in _UNSPECIFIED_NETWORKS):
        return "unspecified"
    return "global"


def _classify_hostname(host: str) -> str:
    normalized = host.casefold().strip()
    if normalized in _DENIED_HOST_NAMES:
        return "loopback"
    return "hostname"


def is_denied_remote_target(host: str) -> bool:
    """Return ``True`` when ``host`` must never be dialed by a remote provider.

    Loopback, link-local (incl. cloud metadata), multicast, unspecified and
    broadcast targets are always denied. Private RFC1918 ranges are allowed
    (LAN-hosted services are a supported configuration).
    """
    return classify_host(host) in {"loopback", "link-local", "multicast", "unspecified"}


def validate_remote_base_url(base_url: str, *, allow_loopback: bool = False) -> str:
    """Validate an outbound provider ``base_url`` against the SSRF policy.

    Returns the normalized ``base_url`` when the target is acceptable, or raises
    ``ValueError`` with a user-readable reason otherwise. ``allow_loopback`` is
    for the local-provider path, which legitimately dials ``127.0.0.1``.
    """
    normalized = base_url.strip().rstrip("/")
    parsed = urlparse(normalized)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("base_url must be an http(s) URL")
    if parsed.username is not None or parsed.password is not None:
        raise ValueError("base_url must not contain credentials")

    classification = classify_host(parsed.hostname)
    if classification == "loopback":
        if allow_loopback:
            return normalized
        raise ValueError("base_url must not target a loopback host")
    if classification in {"link-local", "multicast", "unspecified"}:
        raise ValueError(
            "base_url must not target a link-local, multicast or reserved address"
        )
    return normalized
