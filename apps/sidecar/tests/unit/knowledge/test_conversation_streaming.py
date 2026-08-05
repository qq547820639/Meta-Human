import base64
import json
from collections.abc import AsyncIterator
from pathlib import Path

import httpx
import pytest
import pytest_asyncio

from voxstudio_core.knowledge.conversation import (
    ConversationService,
    GenerationRegistry,
)
from voxstudio_core.knowledge.history import ConversationHistoryStore
from voxstudio_core.knowledge.indexer import KnowledgeIndexer
from voxstudio_core.knowledge.retrieval import KnowledgeRetriever
from voxstudio_core.persistence.database import Database
from voxstudio_core.providers.local_config import LocalProviderConfig
from voxstudio_core.providers.openai_compatible import (
    OpenAICompatibleClient,
    parse_structured_reply,
)


@pytest_asyncio.fixture
async def database(tmp_path: Path) -> AsyncIterator[Database]:
    database = Database(tmp_path / "stream.sqlite3")
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


def service(
    database: Database,
    handler: httpx.MockTransport,
    *,
    tts=None,
) -> ConversationService:
    return ConversationService(
        retriever=KnowledgeRetriever(database),
        chat_client=chat_client(handler),
        chat_model="local-chat",
        tts_client=tts,
    )


def sse_response(*chunks: str) -> httpx.Response:
    body = b"".join(
        (
            f'data: {{"choices":[{{"delta":{{"content":'
            f'{json.dumps(chunk)}}}}}]}}\n\n'
        ).encode()
        for chunk in chunks
    )
    body += b"data: [DONE]\n\n"
    return httpx.Response(
        200,
        content=body,
        headers={"content-type": "text/event-stream"},
    )


# --- TASK 6: streaming -------------------------------------------------------


@pytest.mark.asyncio
async def test_stream_reply_emits_stages_tokens_citations_and_done(
    database: Database,
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return sse_response("你", "好")

    conversation_service = service(database, httpx.MockTransport(handler))

    events = [
        event
        async for event in conversation_service.stream_reply(
            query="How does entry work?"
        )
    ]

    assert [event["type"] for event in events] == [
        "stage",
        "stage",
        "stage",
        "token",
        "token",
        "citations",
        "done",
    ]
    assert events[0] == {"type": "stage", "stage": "understanding"}
    assert events[1] == {"type": "stage", "stage": "retrieving"}
    assert events[2]["stage"] == "found_sources"
    assert events[2]["count"] == 1
    assert events[3] == {"type": "token", "text": "你"}
    assert events[4] == {"type": "token", "text": "好"}
    assert events[5]["type"] == "citations"
    assert events[5]["grounded"] is False
    assert events[5]["citations"] == []
    assert events[6]["type"] == "done"
    assert events[6]["text"] == "你好"


@pytest.mark.asyncio
async def test_stream_reply_emits_generation_started_first(
    database: Database,
) -> None:
    """The first SSE event must carry the generation_id so the client can stop."""

    def handler(request: httpx.Request) -> httpx.Response:
        return sse_response("你", "好")

    conversation_service = service(database, httpx.MockTransport(handler))
    generation_id = conversation_service.create_generation()

    events = [
        event
        async for event in conversation_service.stream_reply(
            query="How does entry work?",
            generation_id=generation_id,
        )
    ]

    assert events[0]["type"] == "generation_started"
    assert events[0]["generation_id"] == generation_id


@pytest.mark.asyncio
async def test_stream_reply_done_before_tts_and_tts_failure_keeps_text(
    database: Database,
) -> None:
    class FailingTts:
        def __init__(self) -> None:
            self.texts: list[str] = []

        async def synthesize(self, *, text: str) -> bytes:
            self.texts.append(text)
            raise RuntimeError("tts boom")

    tts = FailingTts()

    def handler(request: httpx.Request) -> httpx.Response:
        return sse_response("答案")

    conversation_service = service(
        database,
        httpx.MockTransport(handler),
        tts=tts,
    )

    events = [
        event
        async for event in conversation_service.stream_reply(
            query="How does entry work?"
        )
    ]

    assert events[-1]["type"] == "done"
    assert events[-1]["text"] == "答案"
    assert not any(event["type"] == "error" for event in events)
    assert tts.texts == ["答案"]


@pytest.mark.asyncio
async def test_stream_reply_emits_error_event_on_failure(database: Database) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("network down")

    conversation_service = service(database, httpx.MockTransport(handler))

    events = [
        event
        async for event in conversation_service.stream_reply(
            query="How does entry work?"
        )
    ]

    assert events[-1]["type"] == "error"
    assert events[-1]["code"] == "generation_failed"
    assert events[-1]["retryable"] is False
    assert not any(event["type"] == "done" for event in events)


@pytest.mark.asyncio
async def test_stream_reply_stops_generation_when_requested(
    database: Database,
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return sse_response("一", "二", "三")

    conversation_service = service(database, httpx.MockTransport(handler))
    generation_id = conversation_service.create_generation()

    events: list[dict] = []
    async for event in conversation_service.stream_reply(
        query="How does entry work?",
        generation_id=generation_id,
    ):
        events.append(event)
        if event["type"] == "token":
            conversation_service.stop_generation(generation_id)

    tokens = [event for event in events if event["type"] == "token"]
    assert len(tokens) == 1
    assert events[-1]["type"] == "done"


def test_generation_registry_marks_and_clears_stops() -> None:
    registry = GenerationRegistry()
    generation_id = registry.register()

    assert registry.is_stopped(generation_id) is False
    assert registry.stop(generation_id) is True
    assert registry.is_stopped(generation_id) is True
    assert registry.stop(generation_id) is False

    registry.unregister(generation_id)
    assert registry.is_stopped(generation_id) is False


class RecordingTtsForStream:
    def __init__(self, audio: bytes) -> None:
        self.audio = audio
        self.texts: list[str] = []

    async def synthesize(self, *, text: str) -> bytes:
        self.texts.append(text)
        return self.audio


@pytest.mark.asyncio
async def test_stream_reply_synthesizes_audio_once_and_emits_audio_event(
    database: Database,
) -> None:
    """TTS text must equal the final displayed text, synthesized exactly once."""
    tts = RecordingTtsForStream(b"RIFF-audio")

    def handler(request: httpx.Request) -> httpx.Response:
        return sse_response("你好")

    conversation_service = service(
        database,
        httpx.MockTransport(handler),
        tts=tts,
    )

    events = [
        event
        async for event in conversation_service.stream_reply(
            query="How does entry work?"
        )
    ]

    done = [event for event in events if event["type"] == "done"]
    audio = [event for event in events if event["type"] == "audio"]
    assert len(done) == 1
    assert len(audio) == 1
    assert audio[0]["audio_base64"] == base64.b64encode(b"RIFF-audio").decode(
        "ascii"
    )
    assert tts.texts == [done[0]["text"]]
    assert tts.texts == ["你好"]


@pytest.mark.asyncio
async def test_stream_reply_performs_single_generation_and_single_retrieval(
    database: Database,
) -> None:
    """One UI send must trigger exactly one model completion and one retrieval."""
    chat_calls = {"count": 0}
    retrieval_calls = {"count": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        chat_calls["count"] += 1
        return sse_response("你好")

    class CountingRetriever:
        async def search(
            self,
            *,
            query: str,
            limit: int = 3,
        ):
            retrieval_calls["count"] += 1
            return await KnowledgeRetriever(database).search(
                query=query,
                limit=limit,
            )

    conversation_service = ConversationService(
        retriever=CountingRetriever(),
        chat_client=chat_client(httpx.MockTransport(handler)),
        chat_model="local-chat",
    )

    events = [
        event
        async for event in conversation_service.stream_reply(
            query="How does entry work?"
        )
    ]

    assert chat_calls["count"] == 1
    assert retrieval_calls["count"] == 1
    assert events[-1]["type"] == "done"


@pytest.mark.asyncio
async def test_stream_reply_persists_one_user_and_one_assistant(
    database: Database,
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return sse_response("回答")

    history = ConversationHistoryStore(database)
    conversation_service = ConversationService(
        retriever=KnowledgeRetriever(database),
        chat_client=chat_client(httpx.MockTransport(handler)),
        chat_model="local-chat",
        history=history,
    )

    events = [
        event
        async for event in conversation_service.stream_reply(query="问题")
    ]
    assert [event["type"] for event in events].count("done") == 1

    recent = await history.list_recent()
    assert [(m.role, m.content) for m in recent] == [
        ("user", "问题"),
        ("assistant", "回答"),
    ]


@pytest.mark.asyncio
async def test_stream_reply_regenerate_appends_only_one_assistant(
    database: Database,
) -> None:
    responses = iter(["旧回答", "新回答"])

    def handler(request: httpx.Request) -> httpx.Response:
        return sse_response(next(responses))

    history = ConversationHistoryStore(database)
    conversation_service = ConversationService(
        retriever=KnowledgeRetriever(database),
        chat_client=chat_client(httpx.MockTransport(handler)),
        chat_model="local-chat",
        history=history,
    )

    await _drain(conversation_service.stream_reply(query="问题"))
    await _drain(
        conversation_service.stream_reply(query="问题", regenerate=True)
    )

    recent = await history.list_recent()
    assert [(m.role, m.content) for m in recent] == [
        ("user", "问题"),
        ("assistant", "新回答"),
    ]


async def _drain(stream) -> None:
    async for _ in stream:
        pass


# --- TASK 8: structured citations --------------------------------------------

def test_parse_structured_reply_falls_back_to_none_for_plain_text() -> None:
    assert parse_structured_reply("Wearable Guide explains rear entry.") is None
    assert parse_structured_reply("not json") is None


@pytest.mark.asyncio
async def test_reply_validates_source_ids_and_exposes_structured_fields(
    database: Database,
) -> None:
    structured = json.dumps(
        {
            "answer": "Wearable Guide 说明后入式。",
            "used_source_ids": ["doc-1", "doc-999"],
            "confidence": 0.9,
            "insufficient_context": False,
            "suggested_follow_up": None,
        }
    )

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": structured}}]},
        )

    conversation_service = service(database, httpx.MockTransport(handler))

    reply = await conversation_service.reply(query="How does entry work?")

    assert reply.grounded is True
    assert reply.used_source_ids == ("doc-1",)
    assert reply.citations == ("[Wearable Guide]",)
    assert reply.citation_urls == ("https://feishu.cn/docx/doc-1",)
    assert reply.confidence == 0.9
    assert reply.insufficient_context is False
    assert reply.suggested_follow_up is None


@pytest.mark.asyncio
async def test_reply_out_of_query_source_ids_are_dropped(
    database: Database,
) -> None:
    structured = json.dumps(
        {
            "answer": "根据外部来源。",
            "used_source_ids": ["doc-404", "doc-999"],
            "confidence": 0.8,
            "insufficient_context": False,
            "suggested_follow_up": None,
        }
    )

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": structured}}]},
        )

    conversation_service = service(database, httpx.MockTransport(handler))

    reply = await conversation_service.reply(query="How does entry work?")

    assert reply.used_source_ids == ()
    assert reply.citations == ()
    assert reply.grounded is False


@pytest.mark.asyncio
async def test_reply_insufficient_context_returns_no_citations(
    database: Database,
) -> None:
    structured = json.dumps(
        {
            "answer": "没有找到可靠信息，请补充知识源或换个问法。",
            "used_source_ids": [],
            "confidence": 0.1,
            "insufficient_context": True,
            "suggested_follow_up": "补充更多资料",
        }
    )

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": structured}}]},
        )

    conversation_service = service(database, httpx.MockTransport(handler))

    reply = await conversation_service.reply(query="How does entry work?")

    assert reply.grounded is False
    assert reply.citations == ()
    assert reply.used_source_ids == ()
    assert reply.insufficient_context is True
    assert reply.suggested_follow_up == "补充更多资料"
    assert "没有找到可靠信息" in reply.text
