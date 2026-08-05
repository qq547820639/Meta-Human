"""Capacity / performance tests for realistic data volumes.

These assert generous, non-flaky bounds (well above expected timings) so they
guard against regression (e.g. an accidental N+1, unbounded memory growth or a
pathological full-table scan) without being flaky on slow CI machines.
"""

from __future__ import annotations

import time
from pathlib import Path

import pytest

from voxstudio_core.knowledge.sources import KnowledgeSourceStore
from voxstudio_core.persistence.conversation_repository import (
    ConversationRepository,
)
from voxstudio_core.persistence.database import Database

# Generous ceilings so the tests are robust on slow machines while still
# catching real performance regressions.
CREATE_BUDGET_SECONDS = 10.0
READ_BUDGET_SECONDS = 2.0
DB_SIZE_CAP_BYTES = 10 * 1024 * 1024


@pytest.mark.asyncio
async def test_long_conversation_50_plus_turns_stays_bounded(
    tmp_path: Path,
) -> None:
    database = Database(tmp_path / "long.sqlite3")
    await database.migrate()
    repository = ConversationRepository(database)
    conversation = await repository.create(title="perf-conversation")

    # A 30-turn exchange = 60 messages (30 user + 30 assistant).
    async with database.transaction() as connection:
        for index in range(60):
            role = "user" if index % 2 == 0 else "assistant"
            await connection.execute(
                """
                INSERT INTO conversation_messages (
                    role, content, citations, grounded, citation_urls, conversation_id
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (role, f"第 {index} 条消息 payload", "", 0, "", conversation.id),
            )

    started = time.monotonic()
    results = await repository.search(query="第 30 条", limit=50)
    elapsed_seconds = time.monotonic() - started

    assert elapsed_seconds < READ_BUDGET_SECONDS
    assert len(results) >= 1
    assert (tmp_path / "long.sqlite3").stat().st_size < DB_SIZE_CAP_BYTES
    await database.close()


@pytest.mark.asyncio
async def test_many_conversations_capacity(tmp_path: Path) -> None:
    database = Database(tmp_path / "many.sqlite3")
    await database.migrate()
    repository = ConversationRepository(database)

    started = time.monotonic()
    for index in range(300):
        await repository.create(title=f"会话 {index}")
    create_elapsed = time.monotonic() - started
    assert create_elapsed < CREATE_BUDGET_SECONDS

    started = time.monotonic()
    count = await repository.count()
    listed = await repository.list(limit=50)
    read_elapsed = time.monotonic() - started

    assert count == 300
    assert len(listed) == 50
    assert read_elapsed < READ_BUDGET_SECONDS
    assert (tmp_path / "many.sqlite3").stat().st_size < DB_SIZE_CAP_BYTES
    await database.close()


@pytest.mark.asyncio
async def test_many_knowledge_documents_capacity(tmp_path: Path) -> None:
    database = Database(tmp_path / "docs.sqlite3")
    await database.migrate()

    async with database.transaction() as connection:
        for index in range(200):
            document_id = f"doc-{index}"
            await connection.execute(
                """
                INSERT INTO knowledge_documents (id, title, content_hash, synced_at)
                VALUES (?, ?, ?, ?)
                """,
                (
                    document_id,
                    f"知识文档 {index}",
                    f"hash-{index}",
                    "2026-01-01T00:00:00Z",
                ),
            )
            await connection.execute(
                """
                INSERT INTO knowledge_chunks (document_id, position, content)
                VALUES (?, ?, ?)
                """,
                (document_id, 0, f"chunk content {index}"),
            )

    store = KnowledgeSourceStore(database)
    started = time.monotonic()
    count = await store.count_sources()
    sources = await store.list_sources(limit=200)
    elapsed_seconds = time.monotonic() - started

    assert count == 200
    assert len(sources) == 200
    assert elapsed_seconds < READ_BUDGET_SECONDS
    assert (tmp_path / "docs.sqlite3").stat().st_size < DB_SIZE_CAP_BYTES
    await database.close()