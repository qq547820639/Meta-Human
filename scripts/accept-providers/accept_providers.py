#!/usr/bin/env python3
"""Real provider acceptance executor.

Runs the full acceptance matrix (local OpenAI-compatible, remote GPU, Feishu,
and credential-free lifecycle checks) and writes a machine-readable JSON report
plus a human-readable Markdown report.

Behaviour:
- Items that need credentials which are missing are reported UNVERIFIED and never
  PASS. A local provider without a reachable service is FLAG (FAIL).
- Exit codes: default exits 0 when there is no FAIL (UNVERIFIED allowed); with
  --strict it exits 0 only when every item is PASS.

Run through the sidecar's uv environment so voxstudio_core is importable:

    uv run --project apps/sidecar python scripts/accept-providers/accept_providers.py

Options:
    --strict        treat any UNVERIFIED or FAIL as a non-zero exit.
    --json PATH     JSON output path (default: REPO_ROOT/output/provider-acceptance.json)
    --md PATH       Markdown output path (default: REPO_ROOT/output/provider-acceptance.md)
    --only CAT      only run a category (local, remote, feishu, lifecycle); repeatable.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import common  # noqa: E402
import feishu  # noqa: E402
import lifecycle  # noqa: E402
import local  # noqa: E402
import remote  # noqa: E402
from common import (  # noqa: E402
    CheckResult,
    build_json_report,
    collect_metadata,
    render_markdown,
    summarize,
)

CATEGORIES = ("local", "remote", "feishu", "lifecycle")


def _parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--strict", action="store_true", help="fail on UNVERIFIED/FAIL")
    parser.add_argument("--json", type=Path, default=None, help="JSON output path")
    parser.add_argument("--md", type=Path, default=None, help="Markdown output path")
    parser.add_argument(
        "--only",
        action="append",
        choices=CATEGORIES,
        default=None,
        help="only run this category (repeatable)",
    )
    return parser.parse_args(argv)


async def _run_all(only: list[str] | None) -> list[CheckResult]:
    categories = {
        "local": local.run_local,
        "remote": remote.run_remote,
        "feishu": feishu.run_feishu,
        "lifecycle": lifecycle.run_lifecycle,
    }
    if only:
        selected = only
    else:
        selected = list(CATEGORIES)

    results: list[CheckResult] = []
    for category in CATEGORIES:
        if category in selected:
            results.extend(await categories[category]())
    return results


def _exit_code(results: list[CheckResult], strict: bool) -> int:
    summary = summarize(results)
    if strict:
        if summary["fail"] > 0 or summary["unverified"] > 0:
            return 1
        return 0
    if summary["fail"] > 0:
        return 1
    return 0


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv if argv is not None else sys.argv[1:])
    metadata = collect_metadata()
    results = asyncio.run(_run_all(args.only))

    root = common.repo_root()
    json_path = args.json or (root / "output" / "provider-acceptance.json")
    md_path = args.md or (root / "output" / "provider-acceptance.md")

    json_path.parent.mkdir(parents=True, exist_ok=True)
    json_path.write_text(
        json.dumps(build_json_report(results, metadata), ensure_ascii=False, indent=2)
        + "\n",
        encoding="utf-8",
    )
    md_path.parent.mkdir(parents=True, exist_ok=True)
    md_path.write_text(render_markdown(results, metadata) + "\n", encoding="utf-8")

    # Human summary to stdout.
    summary = summarize(results)
    print(f"Wrote {json_path}")
    print(f"Wrote {md_path}")
    print(
        f"Summary: {summary['total']} checks -> "
        f"{summary['pass']} PASS, {summary['fail']} FAIL, "
        f"{summary['unverified']} UNVERIFIED"
    )
    for result in results:
        missing = f" (missing {', '.join(result.missing)})" if result.missing else ""
        print(f"  {result.status:<11} {result.id}{missing}")

    code = _exit_code(results, args.strict)
    if code != 0:
        print(
            f"Exit {code}: "
            + ("strict mode found UNVERIFIED/FAIL items" if args.strict else "some checks FAILed")
        )
    return code


if __name__ == "__main__":
    raise SystemExit(main())