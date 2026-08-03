import httpx
import pytest
from pydantic import SecretStr

from voxstudio_core.knowledge.feishu import (
    FeishuApiError,
    FeishuClient,
)


def client(handler: httpx.MockTransport) -> FeishuClient:
    return FeishuClient(
        access_token=SecretStr("feishu-token"),
        transport=handler,
    )


@pytest.mark.asyncio
async def test_list_wiki_nodes_parses_items_and_pagination() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(
            200,
            json={
                "data": {
                    "items": [
                        {
                            "node_token": "node-1",
                            "obj_token": "doc-1",
                            "obj_type": "docx",
                            "title": "Guide",
                            "has_child": False,
                        }
                    ],
                    "has_more": True,
                    "page_token": "next-page",
                }
            },
        )

    feishu = client(httpx.MockTransport(handler))

    nodes, next_token = await feishu.list_wiki_nodes(space_id="space-1")

    assert next_token == "next-page"
    assert len(nodes) == 1
    assert nodes[0].node_token == "node-1"
    assert nodes[0].obj_token == "doc-1"
    assert nodes[0].title == "Guide"
    assert requests[0].headers["authorization"] == "Bearer feishu-token"
    assert "feishu-token" not in str(requests[0].url)


@pytest.mark.asyncio
async def test_list_all_wiki_nodes_traverses_child_pages() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.params.get("parent_node_token") == "parent-1":
            return httpx.Response(
                200,
                json={
                    "data": {
                        "items": [
                            {
                                "node_token": "child-1",
                                "obj_token": "doc-2",
                                "obj_type": "docx",
                                "title": "Child Guide",
                                "has_child": False,
                            }
                        ],
                        "has_more": False,
                    }
                },
            )
        return httpx.Response(
            200,
            json={
                "data": {
                    "items": [
                        {
                            "node_token": "parent-1",
                            "obj_token": "doc-1",
                            "obj_type": "docx",
                            "title": "Parent Guide",
                            "has_child": True,
                        }
                    ],
                    "has_more": False,
                }
            },
        )

    feishu = client(httpx.MockTransport(handler))

    nodes = await feishu.list_all_wiki_nodes(space_id="space-1")

    assert [node.node_token for node in nodes] == ["parent-1", "child-1"]


@pytest.mark.asyncio
async def test_download_docx_returns_raw_content() -> None:
    feishu = client(
        httpx.MockTransport(
            lambda _: httpx.Response(
                200,
                json={
                    "data": {
                        "document_name": "Guide",
                        "content": "This is the raw document text.",
                    }
                },
            )
        )
    )

    document = await feishu.download_docx(document_id="doc-1")

    assert document.title == "Guide"
    assert document.content == "This is the raw document text."


@pytest.mark.asyncio
async def test_http_error_maps_to_safe_api_error() -> None:
    feishu = client(httpx.MockTransport(lambda _: httpx.Response(401)))

    with pytest.raises(FeishuApiError, match="status 401"):
        await feishu.list_wiki_nodes(space_id="space-1")


@pytest.mark.asyncio
async def test_invalid_json_maps_to_safe_api_error() -> None:
    feishu = client(
        httpx.MockTransport(lambda _: httpx.Response(200, text="bad-json"))
    )

    with pytest.raises(FeishuApiError, match="not valid JSON"):
        await feishu.list_wiki_nodes(space_id="space-1")


@pytest.mark.asyncio
async def test_empty_docx_content_is_rejected() -> None:
    feishu = client(
        httpx.MockTransport(
            lambda _: httpx.Response(200, json={"data": {"content": " "}})
        )
    )

    with pytest.raises(FeishuApiError, match="empty"):
        await feishu.download_docx(document_id="doc-1")


@pytest.mark.asyncio
async def test_refresh_access_token_updates_credentials() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path.endswith("/oidc/access_token"):
            return httpx.Response(
                200,
                json={
                    "data": {
                        "access_token": "new-access",
                        "refresh_token": "new-refresh",
                    }
                },
            )
        return httpx.Response(
            200,
            json={"data": {"items": [], "has_more": False}},
        )

    feishu = FeishuClient(
        access_token=SecretStr("old-access"),
        refresh_token=SecretStr("old-refresh"),
        app_id="cli_app",
        app_secret=SecretStr("app-secret"),
        transport=httpx.MockTransport(handler),
    )

    access = await feishu.refresh_access_token()
    assert access == "new-access"
    await feishu.list_wiki_nodes(space_id="space-1")

    assert requests[-1].headers["authorization"] == "Bearer new-access"


@pytest.mark.asyncio
async def test_refresh_access_token_requires_credentials() -> None:
    feishu = client(httpx.MockTransport(lambda _: httpx.Response(200)))

    with pytest.raises(FeishuApiError, match="refresh credentials"):
        await feishu.refresh_access_token()
