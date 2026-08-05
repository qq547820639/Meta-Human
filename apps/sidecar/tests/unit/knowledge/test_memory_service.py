from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
import pytest_asyncio

from voxstudio_core.knowledge.memory import MemoryService
from voxstudio_core.persistence.database import Database
from voxstudio_core.persistence.memory_entry_repository import (
    MemoryEntryRepository,
)


class FakeChatClient:
    def __init__(
        self,
        *,
        text: str | None = None,
        error: Exception | None = None,
    ) -> None:
        self.text = text
        self.error = error
        self.calls: list[str] = []

    async def chat_completion(self, *, model: str, prompt: str) -> object:
        self.calls.append(prompt)
        if self.error is not None:
            raise self.error
        return _Reply(self.text or "")


class _Reply:
    def __init__(self, text: str) -> None:
        self.text = text


@pytest_asyncio.fixture
async def database(tmp_path: Path) -> AsyncIterator[Database]:
    database = Database(tmp_path / "memory_service.sqlite3")
    await database.connect()
    await database.migrate()
    try:
        yield database
    finally:
        await database.close()


def make_service(
    database: Database,
    *,
    client: FakeChatClient | None = None,
    enabled: bool = True,
) -> MemoryService:
    return MemoryService(
        repository=MemoryEntryRepository(database),
        chat_client=client,
        chat_model="local-chat",
        enabled=enabled,
    )


@pytest.mark.asyncio
async def test_record_extracts_classifies_and_stores(database: Database) -> None:
    client = FakeChatClient(
        text=(
            '[{"content":"用户喜欢咖啡","type":"preference","confidence":0.9,'
            '"sensitive":false}]'
        )
    )
    service = make_service(database, client=client)

    await service.record(query="我喜欢咖啡", text="好的")

    entries = await service.list_entries()
    assert len(entries) == 1
    assert entries[0].type == "preference"
    assert entries[0].content == "用户喜欢咖啡"
    assert entries[0].confirmed_by_user is True
    assert entries[0].sensitive is False


@pytest.mark.asyncio
async def test_record_skips_sensitive_by_default(database: Database) -> None:
    client = FakeChatClient(
        text='[{"content":"我的银行卡密码","type":"user_fact","confidence":0.9,'
        '"sensitive":true}]'
    )
    service = make_service(database, client=client)

    await service.record(query="我的银行卡密码是123", text="好的")

    assert await service.list_entries() == ()


@pytest.mark.asyncio
async def test_record_marks_conflicts_with_group(database: Database) -> None:
    first = FakeChatClient(
        text='[{"content":"用户喜欢咖啡","type":"preference","confidence":0.9,'
        '"sensitive":false}]'
    )
    service = make_service(database, client=first)
    await service.record(query="我喜欢咖啡", text="好的")

    service._chat_client = FakeChatClient(
        text='[{"content":"用户不喜欢咖啡","type":"preference","confidence":0.9,'
        '"sensitive":false}]'
    )
    await service.record(query="我讨厌咖啡", text="明白")

    entries = await service.list_entries()
    assert len(entries) == 2
    assert entries[0].content == "用户不喜欢咖啡"
    assert entries[0].conflict_group is not None
    assert entries[1].content == "用户喜欢咖啡"


@pytest.mark.asyncio
async def test_extraction_failure_does_not_raise(database: Database) -> None:
    client = FakeChatClient(error=RuntimeError("provider down"))
    service = make_service(database, client=client)

    await service.record(query="问题", text="回答")  # must not raise

    assert await service.list_entries() == ()


@pytest.mark.asyncio
async def test_invalid_json_returns_no_entries(database: Database) -> None:
    client = FakeChatClient(text="not json at all")
    service = make_service(database, client=client)

    await service.record(query="问题", text="回答")

    assert await service.list_entries() == ()


@pytest.mark.asyncio
async def test_disabled_service_does_not_record(database: Database) -> None:
    client = FakeChatClient(
        text='[{"content":"用户喜欢咖啡","type":"preference","confidence":0.9,'
        '"sensitive":false}]'
    )
    service = make_service(database, client=client, enabled=False)

    await service.record(query="我喜欢咖啡", text="好的")

    assert await service.list_entries() == ()
    assert service.enabled is False

    service.set_enabled(True)
    await service.record(query="我喜欢咖啡", text="好的")
    assert len(await service.list_entries()) == 1


@pytest.mark.asyncio
async def test_prune_expired_removes_expired_entries(database: Database) -> None:
    service = make_service(database, client=FakeChatClient())
    expired = await service._repository.create(
        type="goal",
        content="过期目标",
        expires_at=(datetime.now(UTC) - timedelta(seconds=5)).isoformat(),
    )
    active = await service._repository.create(
        type="goal",
        content="活跃目标",
        expires_at=(datetime.now(UTC) + timedelta(days=1)).isoformat(),
    )

    removed = await service.prune_expired()

    assert removed == 1
    remaining = await service.list_entries()
    assert [entry.id for entry in remaining] == [active.id]
    assert expired.id not in [entry.id for entry in remaining]


@pytest.mark.asyncio
async def test_load_for_prompt_prunes_and_returns_active(database: Database) -> None:
    service = make_service(database, client=FakeChatClient())
    await service._repository.create(
        type="goal",
        content="过期目标",
        expires_at=(datetime.now(UTC) - timedelta(seconds=5)).isoformat(),
    )
    await service._repository.create(
        type="goal",
        content="活跃目标",
        expires_at=(datetime.now(UTC) + timedelta(days=1)).isoformat(),
    )

    entries = await service.load_for_prompt()

    assert [entry.content for entry in entries] == ["活跃目标"]


@pytest.mark.asyncio
async def test_record_marks_source_user_for_explicit_requests(
    database: Database,
) -> None:
    client = FakeChatClient(
        text='[{"content":"请记住我的生日","type":"explicit_request",'
        '"confidence":0.9,"sensitive":false}]'
    )
    service = make_service(database, client=client)

    await service.record(query="请记住我的生日是5月1日", text="好的")

    entries = await service.list_entries()
    assert len(entries) == 1
    assert entries[0].source == "user"
    assert entries[0].created_at  # creation time is recorded


@pytest.mark.asyncio
async def test_record_marks_source_system_for_auto_summary(
    database: Database,
) -> None:
    client = FakeChatClient(
        text='[{"content":"用户喜欢咖啡","type":"preference",'
        '"confidence":0.9,"sensitive":false}]'
    )
    service = make_service(database, client=client)

    await service.record(query="我喜欢咖啡", text="好的")

    assert (await service.list_entries())[0].source == "system"


@pytest.mark.asyncio
async def test_record_scopes_entries_by_scope_and_scope_id(
    database: Database,
) -> None:
    client = FakeChatClient(
        text='[{"content":"该数字人的偏好","type":"preference",'
        '"confidence":0.9,"sensitive":false}]'
    )
    service = make_service(database, client=client)

    await service.record(
        query="记住这个",
        text="好",
        scope="digital_human",
        scope_id="dh-1",
    )

    entries = await service.list_entries()
    assert entries[0].scope == "digital_human"
    assert entries[0].scope_id == "dh-1"

    scoped = await service.list_entries(scope="digital_human", scope_id="dh-1")
    assert len(scoped) == 1
    other = await service.list_entries(scope="digital_human", scope_id="dh-2")
    assert other == ()


@pytest.mark.asyncio
async def test_ignore_rule_blocks_future_storage_of_type(
    database: Database,
) -> None:
    service = make_service(database, client=FakeChatClient())
    await service.ignore_memory_type(type="preference")

    client = FakeChatClient(
        text='[{"content":"用户喜欢咖啡","type":"preference",'
        '"confidence":0.9,"sensitive":false}]'
    )
    service._chat_client = client
    await service.record(query="我喜欢咖啡", text="好的")

    assert await service.list_entries() == ()
    rules = await service.list_ignore_rules()
    assert len(rules) == 1
    assert rules[0].type == "preference"

    await service.unignore_memory_type(rules[0].id)
    await service.record(query="我喜欢咖啡", text="好的")
    assert len(await service.list_entries()) == 1


@pytest.mark.asyncio
async def test_prepare_for_injection_masks_sensitive_and_dedupes(
    database: Database,
) -> None:
    service = make_service(database, client=FakeChatClient())
    await service._repository.create(type="preference", content="用户喜欢咖啡")
    await service._repository.create(
        type="preference", content="用户喜欢咖啡", source_message_id="dup"
    )
    await service._repository.create(
        type="user_fact", content="我的银行卡密码是123456", sensitive=True
    )

    lines = await service.prepare_for_injection()

    contents = [line.content for line in lines]
    assert contents.count("用户喜欢咖啡") == 1  # deduplicated
    assert any("银行卡" not in c for c in contents)
    assert any(line.content == "[已隐藏的敏感信息]" for line in lines)


@pytest.mark.asyncio
async def test_prepare_for_injection_flags_conflicts_and_truncates(
    database: Database,
) -> None:
    service = make_service(database, client=FakeChatClient())
    await service._repository.create(type="goal", content="a" * 50)
    await service._repository.create(
        type="preference", content="用户喜欢咖啡", conflict_group="g1"
    )
    await service._repository.create(
        type="preference", content="用户不喜欢咖啡", conflict_group="g1"
    )

    lines = await service.prepare_for_injection(max_chars=40)

    conflicts = [line for line in lines if line.conflict]
    assert len(conflicts) == 2
    # Length budget truncates: not all entries fit.
    assert len(lines) > 0
    assert sum(len(f"[{entry.type}] {entry.content}") for entry in lines) <= 40


@pytest.mark.asyncio
async def test_prepare_for_injection_excludes_disabled(database: Database) -> None:
    service = make_service(database, client=FakeChatClient())
    await service._repository.create(
        type="preference", content="用户喜欢咖啡", disabled=True
    )
    await service._repository.create(type="goal", content="活跃目标")

    lines = await service.prepare_for_injection()

    assert [line.content for line in lines] == ["活跃目标"]


@pytest.mark.asyncio
async def test_permanent_delete_verifies_persistence(database: Database) -> None:
    service = make_service(database, client=FakeChatClient())
    entry = await service._repository.create(type="user_fact", content="待删除")

    verified = await service.permanent_delete(entry.id)

    assert verified is True
    assert await service._repository.exists(entry.id) is False
    assert await service.list_entries() == ()


@pytest.mark.asyncio
async def test_privacy_statement_is_comprehensible(database: Database) -> None:
    service = make_service(database, client=FakeChatClient())
    statement = service.privacy_statement()
    assert "本机" in statement
    assert "删除" in statement
    assert len(statement) > 20
