import httpx

from voxstudio_core.capabilities.base import (
    CapabilityActionRequired,
    CapabilityCheckOutcome,
    CapabilityCheckRequest,
    CapabilityReady,
    CapabilityTransientFailure,
)
from voxstudio_core.knowledge.feishu import FeishuApiError, FeishuClient
from voxstudio_core.knowledge.indexer import KnowledgeIndexer
from voxstudio_core.knowledge.retrieval import KnowledgeRetriever


class FeishuKnowledgeAdapter:
    def __init__(
        self,
        *,
        client: FeishuClient,
        indexer: KnowledgeIndexer,
        retriever: KnowledgeRetriever,
        space_id: str,
    ) -> None:
        self._client = client
        self._indexer = indexer
        self._retriever = retriever
        self._space_id = space_id

    async def check(
        self,
        request: CapabilityCheckRequest,
    ) -> CapabilityCheckOutcome:
        del request
        try:
            nodes = await self._list_all_wiki_nodes()
        except FeishuApiError as error:
            return self._api_error_outcome(error)
        except (httpx.TimeoutException, httpx.RequestError):
            return CapabilityTransientFailure(
                code="feishu_unavailable",
                message="Feishu knowledge could not be reached.",
                safe_detail="Knowledge readiness could not reach Feishu.",
            )

        docx_nodes = [node for node in nodes if node.obj_type == "docx"]
        if not docx_nodes:
            return CapabilityActionRequired(
                code="knowledge_empty_wiki",
                message="The Feishu Wiki has no document to sync.",
                recommended_action="Add a document to Feishu Wiki and try again.",
                safe_detail="Knowledge readiness found no Docx node.",
            )

        for docx_node in docx_nodes:
            try:
                document = await self._download_docx(docx_node.obj_token)
            except FeishuApiError as error:
                return self._api_error_outcome(error)
            except (httpx.TimeoutException, httpx.RequestError):
                return CapabilityTransientFailure(
                    code="feishu_unavailable",
                    message="Feishu knowledge could not be reached.",
                    safe_detail=(
                        "Knowledge readiness could not download a document."
                    ),
                )

            await self._indexer.upsert_document(
                document_id=document.document_id,
                title=document.title,
                content=document.content,
                source_url=(
                    "https://feishu.cn/docx/"
                    f"{document.document_id}"
                ),
            )
        passages = await self._retriever.search(
            query=docx_nodes[0].title,
            limit=1,
        )
        if not passages:
            return CapabilityActionRequired(
                code="knowledge_not_searchable",
                message="Synced knowledge cannot be retrieved.",
                recommended_action="Check document content and try again.",
                safe_detail="Knowledge readiness found no searchable passage.",
            )
        return CapabilityReady(
            safe_detail="Feishu knowledge was synced and cited.",
        )

    async def _list_all_wiki_nodes(self):
        try:
            return await self._client.list_all_wiki_nodes(
                space_id=self._space_id,
            )
        except FeishuApiError as error:
            if not self._auth_error(error):
                raise
            await self._refresh_token()
            return await self._client.list_all_wiki_nodes(
                space_id=self._space_id,
            )

    async def _download_docx(self, document_id: str):
        try:
            return await self._client.download_docx(
                document_id=document_id,
            )
        except FeishuApiError as error:
            if not self._auth_error(error):
                raise
            await self._refresh_token()
            return await self._client.download_docx(
                document_id=document_id,
            )

    async def _refresh_token(self) -> None:
        try:
            await self._client.refresh_access_token()
        except FeishuApiError as error:
            if "refresh credentials" in str(error):
                raise FeishuApiError(
                    "status 401 Feishu token refresh is not configured"
                ) from error
            raise

    def _auth_error(self, error: FeishuApiError) -> bool:
        message = str(error)
        return "status 401" in message or "status 403" in message

    def _api_error_outcome(
        self,
        error: FeishuApiError,
    ) -> CapabilityActionRequired | CapabilityTransientFailure:
        if self._auth_error(error):
            return CapabilityActionRequired(
                code="feishu_authorization_required",
                message="Feishu knowledge access was rejected.",
                recommended_action="Authorize Feishu knowledge access and try again.",
                safe_detail="Knowledge readiness was rejected by Feishu.",
            )
        return CapabilityTransientFailure(
            code="feishu_unavailable",
            message="Feishu knowledge is unavailable.",
            safe_detail="Knowledge readiness could not be completed.",
        )
