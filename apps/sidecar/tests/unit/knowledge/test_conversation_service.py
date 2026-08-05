import base64
import json
from collections.abc import AsyncIterator
from pathlib import Path

import httpx
import pytest
import pytest_asyncio

from voxstudio_core.knowledge.conversation import (
    ConversationService,
    ConversationUnavailableError,
    TranscriptionUnavailableError,
)
from voxstudio_core.knowledge.history import ConversationHistoryStore
from voxstudio_core.knowledge.indexer import KnowledgeIndexer
from voxstudio_core.knowledge.memory import ConversationMemoryStore, MemoryService
from voxstudio_core.knowledge.retrieval import KnowledgeRetriever
from voxstudio_core.persistence.conversation_repository import (
    ConversationRepository,
)
from voxstudio_core.persistence.database import Database
from voxstudio_core.persistence.memory_entry_repository import (
    MemoryEntryRepository,
)
from voxstudio_core.providers.local_config import LocalProviderConfig
from voxstudio_core.providers.openai_compatible import OpenAICompatibleClient


@pytest_asyncio.fixture
async def database(tmp_path: Path) -> AsyncIterator[Database]:
    database = Database(tmp_path / "conversation.sqlite3")
    await database.connect()
    await database.migrate()
    indexer = KnowledgeIndexer(database)
    await indexer.upsert_document(
        document_id="doc-1",
        title="Wearable Guide",
        content="The exoskeleton uses a rear-entry mechanism.",
        source_url="https://feishu.cn/docx/doc-1",
    )
    try:
        yield database
    finally:
        await database.close()


def chat_client(handler: httpx.MockTransport) -> OpenAICompatibleClient:
    config = LocalProviderConfig(
        base_url="http://127.0.0.1:11434",
        chat_model="local-chat",
        embedding_model="local-embed",
    )
    return OpenAICompatibleClient(config, transport=handler)


class StubTts:
    def __init__(self, audio: bytes | None = None, fail: bool = False) -> None:
        self.audio = audio
        self.fail = fail
        self.texts: list[str] = []

    async def synthesize(self, *, text: str) -> bytes:
        self.texts.append(text)
        if self.fail:
            raise RuntimeError("tts unavailable")
        return self.audio or b""


@pytest.mark.asyncio
async def test_grounded_reply_returns_citations(
    database: Database,
) -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(
            200,
            json={
                "choices": [
                    {"message": {"content": "Wearable Guide explains rear entry."}}
                ]
            },
        )

    service = ConversationService(
        retriever=KnowledgeRetriever(database),
        chat_client=chat_client(httpx.MockTransport(handler)),
        chat_model="local-chat",
    )

    reply = await service.reply(query="How does entry work?")

    assert reply.grounded is True
    assert reply.citations == ("[Wearable Guide]",)
    assert reply.citation_urls == ("https://feishu.cn/docx/doc-1",)
    assert "Wearable Guide" in requests[0].content.decode()


@pytest.mark.asyncio
async def test_ungrounded_reply_has_no_citations(
    database: Database,
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": "No source found."}}]},
        )

    service = ConversationService(
        retriever=KnowledgeRetriever(database),
        chat_client=chat_client(httpx.MockTransport(handler)),
        chat_model="local-chat",
    )

    reply = await service.reply(query="unrelated question")

    assert reply.grounded is False
    assert reply.citations == ()
    assert reply.text == "No source found."


@pytest.mark.asyncio
async def test_reply_includes_tts_audio_when_configured(
    database: Database,
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": "With audio."}}]},
        )

    tts = StubTts(audio=b"RIFF-audio")
    service = ConversationService(
        retriever=KnowledgeRetriever(database),
        chat_client=chat_client(httpx.MockTransport(handler)),
        chat_model="local-chat",
        tts_client=tts,
    )

    reply = await service.reply(query="speak")

    assert reply.audio_base64 == base64.b64encode(b"RIFF-audio").decode("ascii")
    assert tts.texts == ["With audio."]


@pytest.mark.asyncio
async def test_tts_failure_keeps_text_reply_available(
    database: Database,
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": "Text only."}}]},
        )

    service = ConversationService(
        retriever=KnowledgeRetriever(database),
        chat_client=chat_client(httpx.MockTransport(handler)),
        chat_model="local-chat",
        tts_client=StubTts(fail=True),
    )

    reply = await service.reply(query="speak")

    assert reply.text == "Text only."
    assert reply.audio_base64 is None


@pytest.mark.asyncio
async def test_transcribe_audio_path_returns_text(
    database: Database,
    tmp_path: Path,
) -> None:
    audio_path = tmp_path / "voice.wav"
    audio_path.write_bytes(b"RIFF-voice")

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"text": "语音输入内容"},
        )

    service = ConversationService(
        retriever=KnowledgeRetriever(database),
        chat_client=chat_client(httpx.MockTransport(handler)),
        chat_model="local-chat",
        stt_client=chat_client(httpx.MockTransport(handler)),
        stt_model="local-stt",
    )

    text = await service.transcribe(audio_path=str(audio_path))

    assert text == "语音输入内容"


@pytest.mark.asyncio
async def test_transcribe_requires_stt_configuration(
    database: Database,
) -> None:
    service = ConversationService(
        retriever=KnowledgeRetriever(database),
        chat_client=chat_client(httpx.MockTransport(lambda _: httpx.Response(200))),
        chat_model="local-chat",
    )

    with pytest.raises(TranscriptionUnavailableError):
        await service.transcribe(audio_path="/tmp/voice.wav")


@pytest.mark.asyncio
async def test_history_is_included_in_prompt_and_remembered(
    database: Database,
) -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": "第一答"}}]},
        )

    service = ConversationService(
        retriever=KnowledgeRetriever(database),
        chat_client=chat_client(httpx.MockTransport(handler)),
        chat_model="local-chat",
        history=ConversationHistoryStore(database),
    )

    await service.reply(query="第一问")
    history = await service.recent_history()
    assert [(message.role, message.content) for message in history] == [
        ("user", "第一问"),
        ("assistant", "第一答"),
    ]

    await service.reply(query="第二问")
    assert "user: 第一问" in requests[1].content.decode()
    assert "assistant: 第一答" in requests[1].content.decode()


@pytest.mark.asyncio
async def test_grounded_reply_persists_citations_in_history(
    database: Database,
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "choices": [
                    {"message": {"content": "Wearable Guide explains rear entry."}}
                ]
            },
        )

    history = ConversationHistoryStore(database)
    service = ConversationService(
        retriever=KnowledgeRetriever(database),
        chat_client=chat_client(httpx.MockTransport(handler)),
        chat_model="local-chat",
        history=history,
    )

    await service.reply(query="How does entry work?")
    recent = await history.list_recent()

    assert recent[-1].grounded is True
    assert recent[-1].citations == ("[Wearable Guide]",)
    assert recent[-1].citation_urls == ("https://feishu.cn/docx/doc-1",)


@pytest.mark.asyncio
async def test_reply_is_ungrounded_when_sources_are_ignored(
    database: Database,
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": "I do not know."}}]},
        )

    service = ConversationService(
        retriever=KnowledgeRetriever(database),
        chat_client=chat_client(httpx.MockTransport(handler)),
        chat_model="local-chat",
    )

    reply = await service.reply(query="How does entry work?")

    assert reply.grounded is False
    assert reply.citations == ()
    assert reply.citation_urls == ()


@pytest.mark.asyncio
async def test_long_term_memory_is_summarized_and_injected(
    database: Database,
) -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        payload = json.loads(request.content)
        prompt = payload["messages"][0]["content"]
        if "Summarize the following conversation" in prompt:
            return httpx.Response(
                200,
                json={"choices": [{"message": {"content": "长期记忆摘要"}}]},
            )
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": "普通回答"}}]},
        )

    history = ConversationHistoryStore(database)
    service = ConversationService(
        retriever=KnowledgeRetriever(database),
        chat_client=chat_client(httpx.MockTransport(handler)),
        chat_model="local-chat",
        history=history,
        memory_store=ConversationMemoryStore(database),
        history_limit=4,
        memory_summary_interval=2,
        conversations=ConversationRepository(database),
    )
    conversation = await service.create_conversation()

    await service.reply(query="第一问", conversation_id=conversation.id)
    await service.reply(query="第二问", conversation_id=conversation.id)

    memory = await ConversationMemoryStore(database).load_latest()
    assert memory is not None
    assert memory.summary == "长期记忆摘要"

    await service.reply(query="第三问", conversation_id=conversation.id)
    prompts = [
        json.loads(request.content)["messages"][0]["content"]
        for request in requests
    ]
    assert any(
        "Long-term memory:\n长期记忆摘要" in prompt for prompt in prompts
    )
    summary_prompts = [
        prompt
        for prompt in prompts
        if "Summarize the following conversation" in prompt
    ]
    assert len(summary_prompts) == 1


@pytest.mark.asyncio
async def test_regenerate_replaces_last_assistant_in_history(
    database: Database,
) -> None:
    responses = iter(["旧回答", "新回答"])

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "choices": [
                    {"message": {"content": next(responses)}}
                ]
            },
        )

    history = ConversationHistoryStore(database)
    service = ConversationService(
        retriever=KnowledgeRetriever(database),
        chat_client=chat_client(httpx.MockTransport(handler)),
        chat_model="local-chat",
        history=history,
    )

    await service.reply(query="问题")
    await service.reply(query="问题", regenerate=True)

    recent = await history.list_recent()
    assert [(message.role, message.content) for message in recent] == [
        ("user", "问题"),
        ("assistant", "新回答"),
    ]


# --- TASK 7: conversation management -----------------------------------------


def conversation_service_with_repository(
    database: Database,
) -> ConversationService:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": "回答"}}]},
        )

    return ConversationService(
        retriever=KnowledgeRetriever(database),
        chat_client=chat_client(httpx.MockTransport(handler)),
        chat_model="local-chat",
        conversations=ConversationRepository(database),
        history=ConversationHistoryStore(database),
    )


@pytest.mark.asyncio
async def test_conversation_management_requires_role_configuration(
    database: Database,
) -> None:
    service = ConversationService(
        retriever=KnowledgeRetriever(database),
        chat_client=chat_client(httpx.MockTransport(lambda _: httpx.Response(200))),
        chat_model="local-chat",
    )
    with pytest.raises(ConversationUnavailableError):
        await service.create_conversation()


@pytest.mark.asyncio
async def test_create_and_list_conversations(database: Database) -> None:
    service = conversation_service_with_repository(database)

    first = await service.create_conversation(title="会话一")
    second = await service.create_conversation(avatar_id="avatar-1")

    conversations = await service.list_conversations()
    assert [c.id for c in conversations] == [second.id, first.id]
    assert first.title == "会话一"
    assert second.avatar_id == "avatar-1"
    assert await service.count_conversations() == 2


@pytest.mark.asyncio
async def test_get_rename_and_delete_conversation(database: Database) -> None:
    service = conversation_service_with_repository(database)
    conversation = await service.create_conversation()

    fetched = await service.get_conversation(conversation.id)
    assert fetched.id == conversation.id

    renamed = await service.rename_conversation(conversation.id, title="新标题")
    assert renamed.title == "新标题"

    await service.delete_conversation(conversation.id)
    assert [c.id for c in await service.list_conversations()] == []
    assert (await service.get_conversation(conversation.id)).deleted is True


@pytest.mark.asyncio
async def test_archive_and_clear_conversation(database: Database) -> None:
    service = conversation_service_with_repository(database)
    conversation = await service.create_conversation()
    await service.reply(
        query="你好",
        conversation_id=conversation.id,
    )

    archived = await service.archive_conversation(conversation.id, archived=True)
    assert archived.archived is True

    await service.clear_conversation(conversation.id)
    reloaded = await service.get_conversation(conversation.id)
    assert reloaded.last_message_at is None
    assert await service.recent_history() == ()


@pytest.mark.asyncio
async def test_export_conversation_includes_messages(database: Database) -> None:
    service = conversation_service_with_repository(database)
    conversation = await service.create_conversation(title="导出")
    await service.reply(
        query="问题",
        conversation_id=conversation.id,
    )

    exported = await service.export_conversation(conversation.id)
    assert exported["conversation"].title == "导出"
    assert [m["role"] for m in exported["messages"]] == ["user", "assistant"]


@pytest.mark.asyncio
async def test_search_conversations(database: Database) -> None:
    service = conversation_service_with_repository(database)
    conversation = await service.create_conversation(title="飞行器指南")

    hits = await service.search_conversations(query="飞行器")
    assert [c.id for c in hits] == [conversation.id]

    misses = await service.search_conversations(query="不存在")
    assert misses == ()


# --- P0: per-conversation context isolation ---------------------------------


def isolation_service(database: Database) -> ConversationService:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": "回答"}}]},
        )

    return ConversationService(
        retriever=KnowledgeRetriever(database),
        chat_client=chat_client(httpx.MockTransport(handler)),
        chat_model="local-chat",
        history=ConversationHistoryStore(database),
        conversations=ConversationRepository(database),
    )


@pytest.mark.asyncio
async def test_two_conversations_do_not_leak_history_into_prompt(
    database: Database,
) -> None:
    """A conversation's prompt must never contain another conversation's text."""
    service = isolation_service(database)
    conv_a = await service.create_conversation()
    conv_b = await service.create_conversation()

    await service.reply(
        query="SECRET_A 的消息",
        conversation_id=conv_a.id,
    )
    await service.reply(
        query="SECRET_B 的消息",
        conversation_id=conv_b.id,
    )

    prompt_a = await service._build_prompt(
        query="追问",
        conversation_id=conv_a.id,
    )
    prompt_b = await service._build_prompt(
        query="追问",
        conversation_id=conv_b.id,
    )

    assert "SECRET_A" in prompt_a
    assert "SECRET_B" not in prompt_a
    assert "SECRET_B" in prompt_b
    assert "SECRET_A" not in prompt_b


@pytest.mark.asyncio
async def test_prompt_for_only_includes_current_conversation_messages(
    database: Database,
) -> None:
    service = isolation_service(database)
    conv_a = await service.create_conversation()
    conv_b = await service.create_conversation()

    await service.reply(
        query="仅属于A的内容",
        conversation_id=conv_a.id,
    )
    await service.reply(
        query="仅属于B的内容",
        conversation_id=conv_b.id,
    )

    prompt_a = await service._prompt_for(
        query="追问",
        passages=(),
        conversation_id=conv_a.id,
    )

    assert "仅属于A的内容" in prompt_a
    assert "仅属于B的内容" not in prompt_a


@pytest.mark.asyncio
async def test_regenerate_only_touches_current_conversation(
    database: Database,
) -> None:
    """Regenerating conversation A must not delete/modify conversation B."""
    history = ConversationHistoryStore(database)
    service = ConversationService(
        retriever=KnowledgeRetriever(database),
        chat_client=chat_client(
            httpx.MockTransport(
                lambda _: httpx.Response(
                    200,
                    json={"choices": [{"message": {"content": "A答新"}}]},
                )
            )
        ),
        chat_model="local-chat",
        history=history,
        conversations=ConversationRepository(database),
    )
    conv_a = await service.create_conversation()
    conv_b = await service.create_conversation()

    await history.append(
        role="user",
        content="A问",
        conversation_id=conv_a.id,
    )
    await history.append(
        role="assistant",
        content="A答旧",
        conversation_id=conv_a.id,
    )
    await history.append(
        role="user",
        content="B问",
        conversation_id=conv_b.id,
    )
    await history.append(
        role="assistant",
        content="B答",
        conversation_id=conv_b.id,
    )

    await service.reply(
        query="A问",
        regenerate=True,
        conversation_id=conv_a.id,
    )

    conv_a_recent = await history.list_recent(conversation_id=conv_a.id)
    assert [(m.role, m.content) for m in conv_a_recent] == [
        ("user", "A问"),
        ("assistant", "A答新"),
    ]

    conv_b_recent = await history.list_recent(conversation_id=conv_b.id)
    assert [(m.role, m.content) for m in conv_b_recent] == [
        ("user", "B问"),
        ("assistant", "B答"),
    ]


@pytest.mark.asyncio
async def test_temporary_session_does_not_write_long_term_memory(
    database: Database,
) -> None:
    """A session without a conversation_id must not write global long-term memory."""
    history = ConversationHistoryStore(database)
    memory_store = ConversationMemoryStore(database)
    memory_service = MemoryService(
        repository=MemoryEntryRepository(database),
        chat_model="local-chat",
    )
    service = ConversationService(
        retriever=KnowledgeRetriever(database),
        chat_client=chat_client(
            httpx.MockTransport(
                lambda _: httpx.Response(
                    200,
                    json={"choices": [{"message": {"content": "回答"}}]},
                )
            )
        ),
        chat_model="local-chat",
        history=history,
        memory_store=memory_store,
        memory_service=memory_service,
        memory_summary_interval=1,
    )

    await service.reply(query="临时会话的问题")

    assert await memory_store.load_latest() is None
    assert await memory_service.list_entries() == ()


@pytest.mark.asyncio
async def test_temporary_conversation_does_not_write_long_term_memory(
    database: Database,
) -> None:
    """A conversation in "临时对话" mode must not write long-term memory."""
    history = ConversationHistoryStore(database)
    memory_store = ConversationMemoryStore(database)
    memory_service = MemoryService(
        repository=MemoryEntryRepository(database),
        chat_model="local-chat",
    )
    conversations = ConversationRepository(database)
    service = ConversationService(
        retriever=KnowledgeRetriever(database),
        chat_client=chat_client(
            httpx.MockTransport(
                lambda _: httpx.Response(
                    200,
                    json={"choices": [{"message": {"content": "回答"}}]},
                )
            )
        ),
        chat_model="local-chat",
        history=history,
        memory_store=memory_store,
        memory_service=memory_service,
        memory_summary_interval=1,
        conversations=conversations,
    )

    conversation = await service.create_conversation(title="临时")
    await service.set_temporary_conversation(
        conversation.id, is_temporary=True
    )

    await service.reply(
        query="请记住我喝美式", conversation_id=conversation.id
    )

    assert await memory_store.load_latest() is None
    assert await memory_service.list_entries() == ()


@pytest.mark.asyncio
async def test_normal_conversation_writes_long_term_memory(
    database: Database,
) -> None:
    """A non-temporary, active conversation writes long-term memory."""
    history = ConversationHistoryStore(database)
    memory_store = ConversationMemoryStore(database)
    memory_service = MemoryService(
        repository=MemoryEntryRepository(database),
        chat_model="local-chat",
    )
    conversations = ConversationRepository(database)
    service = ConversationService(
        retriever=KnowledgeRetriever(database),
        chat_client=chat_client(
            httpx.MockTransport(
                lambda _: httpx.Response(
                    200,
                    json={"choices": [{"message": {"content": "回答"}}]},
                )
            )
        ),
        chat_model="local-chat",
        history=history,
        memory_store=memory_store,
        memory_service=memory_service,
        memory_summary_interval=1,
        conversations=conversations,
    )

    conversation = await service.create_conversation(title="正常")

    await service.reply(
        query="请记住我喝美式", conversation_id=conversation.id
    )

    assert await memory_store.load_latest() is not None
