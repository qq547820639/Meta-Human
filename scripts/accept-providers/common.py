"""Shared model, helpers, and environment-metadata collection for the real
provider acceptance executor (scripts/accept-providers/).

A check is one discrete acceptance item. It always records one of three
statuses:

- PASS        the item was genuinely exercised against a reachable provider
              (or a real, credential-free lifecycle path) and passed.
- FAIL        the item is configured/expected but the probe failed.
- UNVERIFIED  the item could not be exercised because required credentials
              (environment variables) are missing, or because a prerequisite
              (e.g. a reachable local service) is absent. Missing credentials
              are NEVER reported as PASS.

The executor is deliberately a standalone script (run through the sidecar's uv
environment with `uv run --project apps/sidecar python ...`) so it can import
voxstudio_core and reuse the same provider/lifecycle/persistence code paths the
product uses, without being collected by the default pytest run.
"""

from __future__ import annotations

import os
import platform
import re
import subprocess
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

STATUS_PASS = "PASS"
STATUS_FAIL = "FAIL"
STATUS_UNVERIFIED = "UNVERIFIED"

VALID_STATUSES = {STATUS_PASS, STATUS_FAIL, STATUS_UNVERIFIED}


@dataclass
class CheckResult:
    """Machine-readable outcome of a single acceptance item."""

    id: str
    name: str
    category: str
    status: str
    evidence: str = ""
    duration_ms: int = 0
    error: str | None = None
    fix_hint: str | None = None
    missing: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, object]:
        return {
            "id": self.id,
            "name": self.name,
            "category": self.category,
            "status": self.status,
            "evidence": self.evidence,
            "duration_ms": self.duration_ms,
            "error": self.error,
            "fix_hint": self.fix_hint,
            "missing": list(self.missing),
        }


def env(name: str) -> str | None:
    value = os.environ.get(name)
    return value or None


def mark_unverified(
    result: CheckResult,
    missing: list[str],
    *,
    reason: str | None = None,
) -> CheckResult:
    """Mark a check UNVERIFIED because credentials are missing."""
    result.status = STATUS_UNVERIFIED
    result.missing = list(missing)
    result.fix_hint = reason or (
        "set: " + ", ".join(missing)
    )
    return result


def finish(result: CheckResult, started: float) -> CheckResult:
    result.duration_ms = int((__import__("time").perf_counter() - started) * 1000)
    return result


def repo_root() -> Path:
    # scripts/accept-providers/common.py -> repo root
    return Path(__file__).resolve().parents[2]


def collect_metadata() -> dict[str, str]:
    root = repo_root()

    version = "0.1.0"
    pyproject = root / "apps" / "sidecar" / "pyproject.toml"
    try:
        text = pyproject.read_text(encoding="utf-8")
        match = re.search(r'^version\s*=\s*"([^"]+)"', text, re.MULTILINE)
        if match:
            version = match.group(1)
    except OSError:
        pass

    commit = "unknown"
    try:
        proc = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=root,
            capture_output=True,
            text=True,
            timeout=5,
        )
        if proc.returncode == 0:
            commit = proc.stdout.strip()
    except Exception:
        pass

    return {
        "generated_at": datetime.now(UTC).isoformat() + "Z",
        "version": version,
        "commit_sha": commit,
        "cpu_arch": platform.machine(),
        "provider_version": "UNKNOWN",
    }


def summarize(results: list[CheckResult]) -> dict[str, int]:
    counts = {STATUS_PASS: 0, STATUS_FAIL: 0, STATUS_UNVERIFIED: 0}
    for result in results:
        counts[result.status] = counts.get(result.status, 0) + 1
    return {
        "total": len(results),
        "pass": counts[STATUS_PASS],
        "fail": counts[STATUS_FAIL],
        "unverified": counts[STATUS_UNVERIFIED],
    }


def build_json_report(
    results: list[CheckResult],
    metadata: dict[str, str],
) -> dict[str, object]:
    return {
        "report": {
            **metadata,
            "summary": summarize(results),
        },
        "checks": [result.to_dict() for result in results],
    }


def render_markdown(
    results: list[CheckResult],
    metadata: dict[str, str],
) -> str:
    summary = summarize(results)
    lines: list[str] = []
    lines.append("# Real Provider Acceptance")
    lines.append("")
    lines.append(f"- 生成时间: `{metadata['generated_at']}`")
    lines.append(f"- 版本: `{metadata['version']}`")
    lines.append(f"- commit SHA: `{metadata['commit_sha']}`")
    lines.append(f"- CPU 架构: `{metadata['cpu_arch']}`")
    lines.append(f"- provider 版本: `{metadata['provider_version']}`")
    lines.append("")
    lines.append("## 汇总")
    lines.append("")
    lines.append(
        f"| 项数 | PASS | FAIL | UNVERIFIED |"
    )
    lines.append(
        f"| --- | --- | --- | --- |"
    )
    lines.append(
        f"| {summary['total']} | {summary['pass']} | {summary['fail']} | "
        f"{summary['unverified']} |"
    )
    lines.append("")

    by_category: dict[str, list[CheckResult]] = {}
    for result in results:
        by_category.setdefault(result.category, []).append(result)

    for category in sorted(by_category):
        lines.append(f"## {category}")
        lines.append("")
        lines.append("| id | 状态 | 说明 | 缺失凭证 |")
        lines.append("| --- | --- | --- | --- |")
        for result in by_category[category]:
            missing = ", ".join(result.missing) if result.missing else "-"
            lines.append(f"| {result.id} | {result.status} | {result.evidence} | {missing} |")
        lines.append("")

    lines.append("## 失败 / 未验证项修复提示")
    lines.append("")
    for result in results:
        if result.status in (STATUS_FAIL, STATUS_UNVERIFIED):
            hint = result.fix_hint or "-"
            lines.append(f"- **{result.id}** ({result.status}): {hint}")
    lines.append("")
    return "\n".join(lines)