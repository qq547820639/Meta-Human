"""Feishu knowledge acceptance checks.

Reuses the product's ``FeishuClient`` / ``FeishuOAuthClient``. All checks are
read-only (wiki listing, docx download, sync/citation surface). When required
credentials are missing the items are UNVERIFIED and list the missing
environment variables — never PASS.

Credentials for real execution:
  VOXSTUDIO_FEISHU_APP_ID, VOXSTUDIO_FEISHU_APP_SECRET, VOXSTUDIO_FEISHU_SPACE_ID,
  VOXSTUDIO_FEISHU_ACCESS_TOKEN (user token; optional if app creds work)
"""

from __future__ import annotations

import time

import httpx
from pydantic import SecretStr

from voxstudio_core.knowledge.feishu import FeishuClient

import common
from common import (
    STATUS_FAIL,
    STATUS_PASS,
    STATUS_UNVERIFIED,
    CheckResult,
    env,
    finish,
    mark_unverified,
)

CATEGORY = "feishu"

REQUIRED = [
    "VOXSTUDIO_FEISHU_APP_ID",
    "VOXSTUDIO_FEISHU_APP_SECRET",
    "VOXSTUDIO_FEISHU_SPACE_ID",
]


def _result(item_id: str, name: str) -> CheckResult:
    return CheckResult(id=item_id, name=name, category=CATEGORY, status=STATUS_UNVERIFIED)


async def _resolve_access_token() -> tuple[str | None, str | None]:
    """Return (access_token, error). Prefer the user token; otherwise try to
    obtain a tenant_access_token from the app credentials."""
    access_token = env("VOXSTUDIO_FEISHU_ACCESS_TOKEN")
    if access_token:
        return access_token, None
    app_id = env("VOXSTUDIO_FEISHU_APP_ID")
    app_secret = env("VOXSTUDIO_FEISHU_APP_SECRET")
    if app_id and app_secret:
        try:
            base = env("VOXSTUDIO_FEISHU_BASE_URL") or "https://open.feishu.cn"
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.post(
                    f"{base}/open-apis/auth/v3/tenant_access_token/internal",
                    json={"app_id": app_id, "app_secret": app_secret},
                )
                response.raise_for_status()
                body = response.json()
            if body.get("code") == 0 and body.get("tenant_access_token"):
                return body["tenant_access_token"], None
            return None, f"tenant token rejected: code={body.get('code')}"
        except Exception as error:  # noqa: BLE001
            return None, f"tenant token failed: {error}"
    return None, "no token source configured"


async def run_feishu() -> list[CheckResult]:
    results: list[CheckResult] = []
    missing = [name for name in REQUIRED if not env(name)]

    if missing:
        for item_id, name in [
            ("feishu.token_validity", "飞书 token 有效性"),
            ("feishu.space_permission", "飞书 space 权限"),
            ("feishu.wiki_docx_read", "飞书 Wiki/Docx 读取"),
            ("feishu.incremental_sync", "飞书增量同步"),
            ("feishu.revoke_handling", "飞书删除/失效/权限撤销处理"),
            ("feishu.citation_usable", "飞书回答引用链接可用"),
        ]:
            result = _result(item_id, name)
            mark_unverified(result, missing)
            result.evidence = "blocked: Feishu credentials missing"
            results.append(result)
        return results

    space_id = env("VOXSTUDIO_FEISHU_SPACE_ID")
    assert space_id is not None

    access_token, token_error = await _resolve_access_token()

    token = _result("feishu.token_validity", "飞书 token 有效性")
    started = time.perf_counter()
    if token_error:
        token.status = STATUS_FAIL
        token.error = token_error
        token.evidence = token_error
        token.fix_hint = (
            "set a valid VOXSTUDIO_FEISHU_ACCESS_TOKEN or valid app credentials"
        )
        remaining = [
            ("feishu.space_permission", "飞书 space 权限"),
            ("feishu.wiki_docx_read", "飞书 Wiki/Docx 读取"),
            ("feishu.incremental_sync", "飞书增量同步"),
            ("feishu.revoke_handling", "飞书删除/失效/权限撤销处理"),
            ("feishu.citation_usable", "飞书回答引用链接可用"),
        ]
        for item_id, name in remaining:
            result = _result(item_id, name)
            mark_unverified(result, [], reason="Feishu token could not be established")
            result.evidence = "blocked: Feishu token invalid"
            results.append(result)
        results.insert(0, finish(token, started))
        return results

    token.status = STATUS_PASS
    token.evidence = "Feishu access/tenant token obtained"
    results.append(finish(token, started))

    client = FeishuClient(
        access_token=SecretStr(access_token),
        app_id=env("VOXSTUDIO_FEISHU_APP_ID"),
        app_secret=(
            SecretStr(env("VOXSTUDIO_FEISHU_APP_SECRET"))
            if env("VOXSTUDIO_FEISHU_APP_SECRET")
            else None
        ),
        base_url=env("VOXSTUDIO_FEISHU_BASE_URL") or "https://open.feishu.cn",
    )

    # space permission + wiki listing
    space = _result("feishu.space_permission", "飞书 space 权限")
    started = time.perf_counter()
    try:
        nodes, _ = await client.list_wiki_nodes(space_id=space_id)
        space.status = STATUS_PASS
        space.evidence = f"list_wiki_nodes(space={space_id}) -> {len(nodes)} top-level nodes"
    except Exception as error:  # noqa: BLE001
        space.status = STATUS_FAIL
        space.error = str(error)
        space.evidence = f"list_wiki_nodes failed: {type(error).__name__}"
        space.fix_hint = "verify VOXSTUDIO_FEISHU_SPACE_ID and that the token can read the space"
    results.append(finish(space, started))

    # wiki / docx read
    docx = _result("feishu.wiki_docx_read", "飞书 Wiki/Docx 读取")
    started = time.perf_counter()
    try:
        all_nodes = await client.list_all_wiki_nodes(space_id=space_id)
        docx_nodes = [n for n in all_nodes if n.obj_type == "docx"]
        if not docx_nodes:
            mark_unverified(
                docx,
                [],
                reason="the space has no Docx node to read",
            )
            docx.evidence = f"{len(all_nodes)} wiki nodes, none of type docx"
        else:
            document = await client.download_docx(document_id=docx_nodes[0].obj_token)
            docx.status = STATUS_PASS
            docx.evidence = (
                f"downloaded docx {document.document_id!r} ({len(document.content)} chars)"
            )
    except Exception as error:  # noqa: BLE001
        docx.status = STATUS_FAIL
        docx.error = str(error)
        docx.evidence = f"wiki/docx read failed: {type(error).__name__}"
        docx.fix_hint = "verify the token has docx:document:readonly scope"
    results.append(finish(docx, started))

    # incremental sync surface (read-only enumeration; full sync needs a local index)
    sync = _result("feishu.incremental_sync", "飞书增量同步")
    mark_unverified(
        sync,
        [],
        reason=(
            "full incremental sync requires local indexing (KnowledgeIndexer) and a "
            "real authorized sync run; the token probe only enumerates reachable nodes"
        ),
    )
    sync.evidence = "wiki enumeration OK; full sync is exercised by FeishuKnowledgeAdapter"
    results.append(sync)

    # revoke / invalidate / permission-revoked handling
    revoke = _result("feishu.revoke_handling", "飞书删除/失效/权限撤销处理")
    mark_unverified(
        revoke,
        [],
        reason="revoking access cannot be verified without a second, revoked credential",
    )
    revoke.evidence = "deleting a source / losing permission is covered by the app's knowledge source delete path"
    results.append(revoke)

    # citation links & fragments usable
    cite = _result("feishu.citation_usable", "飞书回答引用链接可用")
    mark_unverified(
        cite,
        [],
        reason="answering with a real citation requires a full grounded conversation",
    )
    cite.evidence = "citation links are persisted and rendered by the GUI; a real grounded answer is required"
    results.append(cite)

    return results