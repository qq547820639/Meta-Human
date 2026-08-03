import base64
import json
from collections.abc import AsyncIterator
from pathlib import Path

import httpx
import pytest
import pytest_asyncio

from voxstudio_core.knowledge.conversation import (
    ConversationService,
    TranscriptionUnavailableError,
)
from voxstudio_core.knowledge.history import ConversationHistoryStore
from voxstudio_core.knowledge.memory import ConversationMemoryStore
from voxstudio_core.knowledge.indexer import KnowledgeIndexer
from voxstudio_core.knowledge.retrieval import KnowledgeRetriever
from voxstudio_core.persistence.database import Database
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
    )

    await service.reply(query="第一问")
    await service.reply(query="第二问")

    memory = await ConversationMemoryStore(database).load_latest()
    assert memory is not None
    assert memory.summary == "长期记忆摘要"

    await service.reply(query="第三问")
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
