from dataclasses import dataclass

import httpx
from pydantic import SecretStr

from voxstudio_core.ssrf import validate_remote_base_url


class FeishuApiError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class WikiNode:
    node_token: str
    obj_token: str
    obj_type: str
    title: str
    has_child: bool
    parent_node_token: str | None


@dataclass(frozen=True, slots=True)
class DocumentContent:
    document_id: str
    title: str
    content: str


class FeishuClient:
    def __init__(
        self,
        *,
        access_token: SecretStr,
        refresh_token: SecretStr | None = None,
        app_id: str | None = None,
        app_secret: SecretStr | None = None,
        base_url: str = "https://open.feishu.cn",
        page_size: int = 50,
        timeout_seconds: float = 10.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._access_token = access_token
        self._refresh_token = refresh_token
        self._app_id = app_id
        self._app_secret = app_secret
        # Feishu is an outbound remote service; apply the SSRF policy so a
        # mis-configured base_url cannot point at loopback/link-local/metadata.
        self._base_url = validate_remote_base_url(base_url).rstrip("/")
        self._page_size = page_size
        self._timeout = timeout_seconds
        self._transport = transport

    async def list_wiki_nodes(
        self,
        *,
        space_id: str,
        page_token: str | None = None,
        parent_node_token: str | None = None,
    ) -> tuple[tuple[WikiNode, ...], str | None]:
        params: dict[str, str | int] = {
            "page_size": self._page_size,
        }
        if parent_node_token:
            params["parent_node_token"] = parent_node_token
        if page_token:
            params["page_token"] = page_token
        async with self._client() as client:
            response = await client.get(
                f"{self._base_url}/open-apis/wiki/v2/spaces/"
                f"{space_id}/nodes",
                params=params,
                headers=self._headers(),
            )
            body = self._json_or_error(response)
            raw_data = body.get("data")
            data = raw_data if isinstance(raw_data, dict) else {}
            items = data.get("items", [])
            nodes = tuple(
                WikiNode(
                    node_token=item["node_token"],
                    obj_token=item["obj_token"],
                    obj_type=item.get("obj_type", ""),
                    title=item.get("title", ""),
                    has_child=bool(item.get("has_child", False)),
                    parent_node_token=item.get("parent_node_token"),
                )
                for item in items
                if isinstance(item, dict) and item.get("node_token")
            )
            has_more = bool(data.get("has_more", False))
            next_token = data.get("page_token") if has_more else None
            return nodes, next_token

    async def list_all_wiki_nodes(
        self,
        *,
        space_id: str,
    ) -> tuple[WikiNode, ...]:
        seen_tokens: set[str] = set()
        nodes: list[WikiNode] = []

        async def collect(parent_node_token: str | None) -> None:
            page_token: str | None = None
            while True:
                page, next_token = await self.list_wiki_nodes(
                    space_id=space_id,
                    page_token=page_token,
                    parent_node_token=parent_node_token,
                )
                for node in page:
                    if node.node_token in seen_tokens:
                        continue
                    seen_tokens.add(node.node_token)
                    nodes.append(node)
                    if node.has_child:
                        await collect(node.node_token)
                if next_token is None:
                    return
                page_token = next_token

        await collect(None)
        return tuple(nodes)

    async def download_docx(self, *, document_id: str) -> DocumentContent:
        async with self._client() as client:
            response = await client.get(
                f"{self._base_url}/open-apis/docx/v1/documents/"
                f"{document_id}/raw_content",
                headers=self._headers(),
            )
            body = self._json_or_error(response)
            raw_data = body.get("data")
            data = raw_data if isinstance(raw_data, dict) else {}
            content = data.get("content")
            if not isinstance(content, str) or not content.strip():
                raise FeishuApiError("docx raw content was empty")
            return DocumentContent(
                document_id=document_id,
                title=data.get("document_name") or document_id,
                content=content,
            )

    async def refresh_access_token(self) -> str:
        if (
            self._refresh_token is None
            or not self._app_id
            or self._app_secret is None
        ):
            raise FeishuApiError("Feishu refresh credentials are missing")
        async with self._client() as client:
            response = await client.post(
                f"{self._base_url}/open-apis/authen/v1/oidc/access_token",
                json={
                    "grant_type": "refresh_token",
                    "refresh_token": self._refresh_token.get_secret_value(),
                    "client_id": self._app_id,
                    "client_secret": self._app_secret.get_secret_value(),
                },
            )
            body = self._json_or_error(response)
        raw_data = body.get("data")
        data = raw_data if isinstance(raw_data, dict) else {}
        access_token = data.get("access_token")
        refresh_token = data.get("refresh_token")
        if not isinstance(access_token, str) or not access_token:
            raise FeishuApiError("Feishu refresh response had no access token")
        self._access_token = SecretStr(access_token)
        if isinstance(refresh_token, str) and refresh_token:
            self._refresh_token = SecretStr(refresh_token)
        return access_token

    def _json_or_error(self, response: httpx.Response) -> dict[str, object]:
        if response.status_code != 200:
            raise FeishuApiError(
                f"Feishu request failed with status {response.status_code}"
            )
        try:
            body = response.json()
        except ValueError as error:
            raise FeishuApiError("Feishu response was not valid JSON") from error
        if not isinstance(body, dict):
            raise FeishuApiError("Feishu response was not an object")
        return body

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self._access_token.get_secret_value()}"
        }

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            timeout=httpx.Timeout(self._timeout),
            transport=self._transport,
        )
