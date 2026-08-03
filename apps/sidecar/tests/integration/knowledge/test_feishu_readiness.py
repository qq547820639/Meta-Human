from collections.abc import AsyncIterator
from pathlib import Path

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI, HTTPException
from pydantic import SecretStr

from voxstudio_core.capabilities.base import CapabilityReady
from voxstudio_core.capabilities.fake import FakeCapabilityAdapter
from voxstudio_core.capabilities.knowledge import FeishuKnowledgeAdapter
from voxstudio_core.capabilities.registry import CapabilityAdapterRegistry
from voxstudio_core.knowledge.feishu import FeishuClient
from voxstudio_core.knowledge.indexer import KnowledgeIndexer
from voxstudio_core.knowledge.retrieval import KnowledgeRetriever
from voxstudio_core.knowledge.sources import KnowledgeSourceStore
from voxstudio_core.persistence.database import Database
from voxstudio_core.persistence.readiness_repository import ReadinessRepository
from voxstudio_core.readiness.models import (
    AggregateState,
    CapabilityId,
    CapabilityState,
    gate_open,
)
from voxstudio_core.readiness.service import ReadinessService


@pytest_asyncio.fixture
async def repository(tmp_path: Path) -> AsyncIterator[ReadinessRepository]:
    database = Database(tmp_path / "feishu-readiness.sqlite3")
    await database.connect()
    await database.migrate()
    try:
        yield ReadinessRepository(database)
    finally:
        await database.close()


def stub_feishu(*, authorized: bool = True) -> FastAPI:
    app = FastAPI()

    @app.get("/open-apis/wiki/v2/spaces/space-1/nodes")
    async def nodes() -> object:
        if not authorized:
            raise HTTPException(status_code=401, detail="unauthorized")
        return {
            "data": {
                "items": [
                    {
                        "node_token": "node-1",
                        "obj_token": "doc-1",
                        "obj_type": "docx",
                        "title": "Guide",
                        "has_child": False,
                    }
                ]
            }
        }

    @app.get("/open-apis/docx/v1/documents/doc-1/raw_content")
    async def raw_content() -> object:
        return {
            "data": {
                "document_name": "Guide",
                "content": "This guide explains the exoskeleton mechanism.",
            }
        }

    return app


def knowledge_registry(
    app: FastAPI,
    database: Database,
) -> CapabilityAdapterRegistry:
    client = FeishuClient(
        access_token=SecretStr("feishu-token"),
        transport=httpx.ASGITransport(app=app),
    )
    indexer = KnowledgeIndexer(database)
    retriever = KnowledgeRetriever(database)
    adapters = {
        capability_id: FakeCapabilityAdapter(
            [CapabilityReady(safe_detail="Capability check passed.")]
        )
        for capability_id in CapabilityId
    }
    adapters[CapabilityId.EMBEDDING_TEXT] = FeishuKnowledgeAdapter(
        client=client,
        indexer=indexer,
        retriever=retriever,
        space_id="space-1",
    )
    return CapabilityAdapterRegistry(adapters)


@pytest.mark.asyncio
async def test_feishu_knowledge_adapter_opens_the_gate(
    repository: ReadinessRepository,
    tmp_path: Path,
) -> None:
    database = Database(tmp_path / "feishu-index.sqlite3")
    await database.connect()
    await database.migrate()
    try:
        service = ReadinessService(
            repository=repository,
            registry=knowledge_registry(stub_feishu(), database),
        )

        result = await service.prepare()

        assert result.state is AggregateState.READY
        assert gate_open(result.capabilities) is True
        knowledge = next(
            capability
            for capability in result.capabilities
            if capability.id is CapabilityId.EMBEDDING_TEXT
        )
        assert knowledge.state is CapabilityState.READY
        assert knowledge.safe_detail == "Feishu knowledge was synced and cited."
    finally:
        await database.close()


@pytest.mark.asyncio
async def test_feishu_rejection_keeps_knowledge_action_required(
    repository: ReadinessRepository,
    tmp_path: Path,
) -> None:
    database = Database(tmp_path / "feishu-index-unauthorized.sqlite3")
    await database.connect()
    await database.migrate()
    try:
        service = ReadinessService(
            repository=repository,
            registry=knowledge_registry(stub_feishu(authorized=False), database),
        )

        result = await service.prepare()

        assert result.state is AggregateState.ACTION_REQUIRED
        assert gate_open(result.capabilities) is False
        knowledge = next(
            capability
            for capability in result.capabilities
            if capability.id is CapabilityId.EMBEDDING_TEXT
        )
        assert knowledge.state is CapabilityState.ACTION_REQUIRED
        assert knowledge.error is not None
        assert knowledge.error.code == "feishu_authorization_required"
    finally:
        await database.close()


@pytest.mark.asyncio
async def test_feishu_knowledge_refreshes_token_after_rejection(
    repository: ReadinessRepository,
    tmp_path: Path,
) -> None:
    node_calls = {"count": 0}

    def stub_refresh() -> FastAPI:
        app = FastAPI()

        @app.post("/open-apis/authen/v1/oidc/access_token")
        async def token() -> dict[str, object]:
            return {
                "data": {
                    "access_token": "new-token",
                    "refresh_token": "new-refresh",
                }
            }

        @app.get("/open-apis/wiki/v2/spaces/space-1/nodes")
        async def nodes() -> object:
            node_calls["count"] += 1
            if node_calls["count"] == 1:
                raise HTTPException(status_code=401, detail="expired")
            return {
                "data": {
                    "items": [
                        {
                            "node_token": "node-1",
                            "obj_token": "doc-1",
                            "obj_type": "docx",
                            "title": "Guide",
                            "has_child": False,
                        }
                    ]
                }
            }

        @app.get("/open-apis/docx/v1/documents/doc-1/raw_content")
        async def raw_content() -> dict[str, object]:
            return {
                "data": {
                    "document_name": "Guide",
                    "content": "This guide explains the refreshed mechanism.",
                }
            }

        return app

    database = Database(tmp_path / "feishu-refresh.sqlite3")
    await database.connect()
    await database.migrate()
    try:
        client = FeishuClient(
            access_token=SecretStr("expired-token"),
            refresh_token=SecretStr("refresh-token"),
            app_id="cli_app",
            app_secret=SecretStr("app-secret"),
            transport=httpx.ASGITransport(app=stub_refresh()),
        )
        adapter = FeishuKnowledgeAdapter(
            client=client,
            indexer=KnowledgeIndexer(database),
            retriever=KnowledgeRetriever(database),
            space_id="space-1",
        )
        adapters = {
            capability_id: FakeCapabilityAdapter(
                [CapabilityReady(safe_detail="Capability check passed.")]
            )
            for capability_id in CapabilityId
        }
        adapters[CapabilityId.EMBEDDING_TEXT] = adapter
        service = ReadinessService(
            repository=repository,
            registry=CapabilityAdapterRegistry(adapters),
        )

        result = await service.prepare()

        assert result.state is AggregateState.READY
        assert node_calls["count"] == 2
    finally:
        await database.close()


@pytest.mark.asyncio
async def test_feishu_knowledge_syncs_all_docx_nodes(
    repository: ReadinessRepository,
    tmp_path: Path,
) -> None:
    def stub_multi() -> FastAPI:
        app = FastAPI()

        @app.get("/open-apis/wiki/v2/spaces/space-1/nodes")
        async def nodes() -> dict[str, object]:
            return {
                "data": {
                    "items": [
                        {
                            "node_token": "node-1",
                            "obj_token": "doc-1",
                            "obj_type": "docx",
                            "title": "Guide One",
                            "has_child": False,
                        },
                        {
                            "node_token": "node-2",
                            "obj_token": "doc-2",
                            "obj_type": "docx",
                            "title": "Guide Two",
                            "has_child": False,
                        },
                    ]
                }
            }

        @app.get("/open-apis/docx/v1/documents/doc-1/raw_content")
        async def doc_one() -> dict[str, object]:
            return {
                "data": {
                    "document_name": "Guide One",
                    "content": "First guide explains entry.",
                }
            }

        @app.get("/open-apis/docx/v1/documents/doc-2/raw_content")
        async def doc_two() -> dict[str, object]:
            return {
                "data": {
                    "document_name": "Guide Two",
                    "content": "Second guide explains maintenance.",
                }
            }

        return app

    database = Database(tmp_path / "feishu-multi.sqlite3")
    await database.connect()
    await database.migrate()
    try:
        client = FeishuClient(
            access_token=SecretStr("feishu-token"),
            transport=httpx.ASGITransport(app=stub_multi()),
        )
        adapter = FeishuKnowledgeAdapter(
            client=client,
            indexer=KnowledgeIndexer(database),
            retriever=KnowledgeRetriever(database),
            space_id="space-1",
        )
        adapters = {
            capability_id: FakeCapabilityAdapter(
                [CapabilityReady(safe_detail="Capability check passed.")]
            )
            for capability_id in CapabilityId
        }
        adapters[CapabilityId.EMBEDDING_TEXT] = adapter
        service = ReadinessService(
            repository=repository,
            registry=CapabilityAdapterRegistry(adapters),
        )

        result = await service.prepare()

        assert result.state is AggregateState.READY
        sources = await KnowledgeSourceStore(database).list_sources()
        assert {source.document_id for source in sources} == {"doc-1", "doc-2"}
    finally:
        await database.close()
