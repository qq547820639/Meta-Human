import base64
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from voxstudio_core.knowledge.history import (
    ConversationHistoryStore,
    ConversationMessage,
)
from voxstudio_core.knowledge.memory import (
    ConversationMemory,
    ConversationMemoryStore,
)
from voxstudio_core.knowledge.retrieval import KnowledgeRetriever
from voxstudio_core.providers.openai_compatible import OpenAICompatibleClient


@dataclass(frozen=True, slots=True)
class ConversationReply:
    text: str
    citations: tuple[str, ...]
    grounded: bool
    audio_base64: str | None = None
    citation_urls: tuple[str | None, ...] = ()


class TranscriptionUnavailableError(RuntimeError):
    pass


class MemoryUnavailableError(RuntimeError):
    pass


class TtsClientPort(Protocol):
    async def synthesize(self, *, text: str) -> bytes: ...


class ConversationService:
    def __init__(
        self,
        *,
        retriever: KnowledgeRetriever,
        chat_client: OpenAICompatibleClient,
        chat_model: str,
        max_sources: int = 2,
        tts_client: TtsClientPort | None = None,
        history: ConversationHistoryStore | None = None,
        history_limit: int = 8,
        memory_store: ConversationMemoryStore | None = None,
        memory_summary_interval: int = 8,
        stt_client: OpenAICompatibleClient | None = None,
        stt_model: str | None = None,
    ) -> None:
        self._retriever = retriever
        self._chat_client = chat_client
        self._chat_model = chat_model
        self._max_sources = max_sources
        self._tts_client = tts_client
        self._history = history
        self._history_limit = history_limit
        self._memory_store = memory_store
        self._memory_summary_interval = memory_summary_interval
        self._stt_client = stt_client
        self._stt_model = stt_model

    async def transcribe(self, *, audio_path: str) -> str:
        if self._stt_client is None or not self._stt_model:
            raise TranscriptionUnavailableError(
                "speech recognition is not configured"
            )
        path = Path(audio_path)
        if not path.is_file():
            raise TranscriptionUnavailableError("recording file is missing")
        return await self._stt_client.transcribe(
            model=self._stt_model,
            audio=path.read_bytes(),
        )

    async def recent_history(
        self,
        *,
        limit: int = 10,
    ) -> tuple[ConversationMessage, ...]:
        if self._history is None:
            return ()
        return await self._history.list_recent(limit=limit)

    async def clear_history(self) -> None:
        if self._history is not None:
            await self._history.clear()
        if self._memory_store is not None:
            await self._memory_store.clear()

    async def current_memory(self) -> ConversationMemory | None:
        if self._memory_store is None:
            return None
        return await self._memory_store.load_latest()

    async def update_memory(self, *, summary: str) -> None:
        if self._memory_store is None:
            raise MemoryUnavailableError("long-term memory is not configured")
        await self._memory_store.save(summary=summary)

    async def clear_memory(self) -> None:
        if self._memory_store is None:
            raise MemoryUnavailableError("long-term memory is not configured")
        await self._memory_store.clear()

    async def reply(
        self,
        *,
        query: str,
        regenerate: bool = False,
    ) -> ConversationReply:
        if regenerate and self._history is not None:
            await self._history.delete_last_assistant()
        passages = await self._retriever.search(
            query=query,
            limit=self._max_sources,
        )
        if not passages:
            prompt = await self._build_prompt(query=query)
            result = await self._chat_client.chat_completion(
                model=self._chat_model,
                prompt=prompt,
            )
            reply = ConversationReply(
                text=result.text,
                citations=(),
                grounded=False,
                citation_urls=(),
            )
            await self._remember(
                query=query,
                text=reply.text,
                regenerate=regenerate,
                citations=reply.citations,
                grounded=reply.grounded,
                citation_urls=reply.citation_urls,
            )
            return await self._with_audio(reply)

        context = "\n\n".join(
            f"[{passage.title}]\n{passage.content}" for passage in passages
        )
        prompt = await self._build_prompt(
            query=query,
            context=(
                "Answer using only the sources below. "
                "Cite each source title you use.\n\n"
                f"{context}"
            ),
        )
        result = await self._chat_client.chat_completion(
            model=self._chat_model,
            prompt=prompt,
        )
        normalized_reply = result.text.casefold()
        cited_passages = tuple(
            passage
            for passage in passages
            if passage.title.casefold() in normalized_reply
        )
        if cited_passages:
            reply = ConversationReply(
                text=result.text,
                citations=tuple(
                    passage.citation() for passage in cited_passages
                ),
                grounded=True,
                citation_urls=tuple(
                    passage.source_url for passage in cited_passages
                ),
            )
        else:
            reply = ConversationReply(
                text=result.text,
                citations=(),
                grounded=False,
                citation_urls=(),
            )
        await self._remember(
            query=query,
            text=reply.text,
            regenerate=regenerate,
            citations=reply.citations,
            grounded=reply.grounded,
            citation_urls=reply.citation_urls,
        )
        return await self._with_audio(reply)

    async def _build_prompt(
        self,
        *,
        query: str,
        context: str | None = None,
    ) -> str:
        sections: list[str] = []
        if context is not None:
            sections.append(context)
        if self._memory_store is not None:
            memory = await self._memory_store.load_latest()
            if memory is not None:
                sections.append(f"Long-term memory:\n{memory.summary}")
        if self._history is not None:
            recent = await self._history.list_recent(
                limit=self._history_limit,
            )
            if recent:
                transcript = "\n".join(
                    f"{'user' if message.role == 'user' else 'assistant'}: "
                    f"{message.content}"
                    for message in recent
                )
                sections.append(f"Conversation history:\n{transcript}")
        sections.append(f"Question: {query}")
        return "\n\n".join(sections)

    async def _remember(
        self,
        *,
        query: str,
        text: str,
        regenerate: bool = False,
        citations: tuple[str, ...] = (),
        grounded: bool = False,
        citation_urls: tuple[str | None, ...] = (),
    ) -> None:
        if self._history is None:
            return
        if not regenerate:
            await self._history.append(role="user", content=query)
        await self._history.append(
            role="assistant",
            content=text,
            citations=citations,
            grounded=grounded,
            citation_urls=citation_urls,
        )
        if self._memory_store is None or self._history is None:
            return
        total_messages = await self._history.count()
        if total_messages % (self._memory_summary_interval * 2) != 0:
            return
        try:
            transcript = "\n".join(
                f"{'user' if message.role == 'user' else 'assistant'}: "
                f"{message.content}"
                for message in await self._history.list_recent(
                    limit=self._history_limit
                )
            )
            prompt = (
                "Summarize the following conversation into one short "
                "long-term memory (max 200 characters). Keep important "
                "facts, preferences, and unanswered intentions.\n\n"
                f"{transcript}"
            )
            summary = await self._chat_client.chat_completion(
                model=self._chat_model,
                prompt=prompt,
            )
            await self._memory_store.save(summary=summary.text)
        except Exception:
            return

    async def _with_audio(self, reply: ConversationReply) -> ConversationReply:
        if self._tts_client is None:
            return reply
        try:
            audio = await self._tts_client.synthesize(text=reply.text)
        except Exception:
            return reply
        if not audio:
            return reply
        return ConversationReply(
            text=reply.text,
            citations=reply.citations,
            grounded=reply.grounded,
            audio_base64=base64.b64encode(audio).decode("ascii"),
            citation_urls=reply.citation_urls,
        )
