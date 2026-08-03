import asyncio
import base64
from dataclasses import dataclass
from pathlib import Path
from typing import AsyncIterator, Protocol
from uuid import uuid4

from voxstudio_core.knowledge.history import (
    ConversationHistoryStore,
    ConversationMessage,
)
from voxstudio_core.knowledge.memory import (
    ConversationMemory,
    ConversationMemoryStore,
    MemoryService,
)
from voxstudio_core.knowledge.retrieval import KnowledgeRetriever, RetrievedPassage
from voxstudio_core.persistence.conversation_repository import (
    DEFAULT_TITLE,
    Conversation,
    ConversationNotFoundError,
    ConversationRepository,
)
from voxstudio_core.providers.openai_compatible import (
    OpenAICompatibleClient,
    StructuredReply,
    parse_structured_reply,
)


@dataclass(frozen=True, slots=True)
class ConversationReply:
    text: str
    citations: tuple[str, ...]
    grounded: bool
    audio_base64: str | None = None
    citation_urls: tuple[str | None, ...] = ()
    used_source_ids: tuple[str, ...] = ()
    confidence: float | None = None
    insufficient_context: bool = False
    suggested_follow_up: str | None = None


class TranscriptionUnavailableError(RuntimeError):
    pass


class MemoryUnavailableError(RuntimeError):
    pass


class ConversationUnavailableError(RuntimeError):
    pass


class TtsClientPort(Protocol):
    async def synthesize(self, *, text: str) -> bytes: ...


class GenerationRegistry:
    """In-memory registry of active generations so a client can stop a run."""

    def __init__(self) -> None:
        self._active: set[str] = set()
        self._stopped: set[str] = set()

    def register(self) -> str:
        generation_id = uuid4().hex
        self._active.add(generation_id)
        return generation_id

    def stop(self, generation_id: str) -> bool:
        if generation_id in self._active and generation_id not in self._stopped:
            self._stopped.add(generation_id)
            return True
        return False

    def is_stopped(self, generation_id: str) -> bool:
        return generation_id in self._stopped

    def unregister(self, generation_id: str) -> None:
        self._active.discard(generation_id)
        self._stopped.discard(generation_id)


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
        memory_service: MemoryService | None = None,
        stt_client: OpenAICompatibleClient | None = None,
        stt_model: str | None = None,
        conversations: ConversationRepository | None = None,
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
        self._memory_service = memory_service
        self._stt_client = stt_client
        self._stt_model = stt_model
        self._conversations = conversations
        self._generations = GenerationRegistry()

    # --- generation registry -------------------------------------------------

    def create_generation(self) -> str:
        return self._generations.register()

    def stop_generation(self, generation_id: str) -> bool:
        return self._generations.stop(generation_id)

    def unregister_generation(self, generation_id: str) -> None:
        self._generations.unregister(generation_id)

    # --- conversation management ---------------------------------------------

    async def create_conversation(
        self,
        *,
        title: str | None = None,
        avatar_id: str | None = None,
    ) -> Conversation:
        repository = self._require_conversations()
        return await repository.create(title=title, avatar_id=avatar_id)

    async def list_conversations(
        self,
        *,
        limit: int = 50,
        offset: int = 0,
        include_archived: bool = True,
    ) -> tuple[Conversation, ...]:
        repository = self._require_conversations()
        return await repository.list(
            limit=limit,
            offset=offset,
            include_archived=include_archived,
        )

    async def get_conversation(self, conversation_id: str) -> Conversation:
        repository = self._require_conversations()
        return await repository.get(conversation_id)

    async def rename_conversation(
        self,
        conversation_id: str,
        *,
        title: str,
    ) -> Conversation:
        repository = self._require_conversations()
        return await repository.rename(conversation_id, title=title)

    async def delete_conversation(self, conversation_id: str) -> None:
        repository = self._require_conversations()
        await repository.delete(conversation_id)

    async def archive_conversation(
        self,
        conversation_id: str,
        *,
        archived: bool = True,
    ) -> Conversation:
        repository = self._require_conversations()
        return await repository.archive(conversation_id, archived=archived)

    async def clear_conversation(self, conversation_id: str) -> None:
        repository = self._require_conversations()
        await repository.clear(conversation_id)
        if self._history is not None:
            await self._history.clear(conversation_id=conversation_id)

    async def search_conversations(
        self,
        *,
        query: str,
        limit: int = 50,
    ) -> tuple[Conversation, ...]:
        repository = self._require_conversations()
        return await repository.search(query=query, limit=limit)

    async def count_conversations(
        self,
        *,
        include_deleted: bool = False,
    ) -> int:
        repository = self._require_conversations()
        return await repository.count(include_deleted=include_deleted)

    async def export_conversation(self, conversation_id: str) -> dict:
        repository = self._require_conversations()
        conversation = await repository.get(conversation_id)
        messages = (
            await self._history.list_recent(
                conversation_id=conversation_id,
                limit=10_000,
            )
            if self._history is not None
            else ()
        )
        return {
            "conversation": conversation,
            "messages": tuple(
                {
                    "role": message.role,
                    "content": message.content,
                    "citations": message.citations,
                    "citation_urls": message.citation_urls,
                    "grounded": message.grounded,
                    "created_at": message.created_at,
                }
                for message in messages
            ),
        }

    def _require_conversations(self) -> ConversationRepository:
        if self._conversations is None:
            raise ConversationUnavailableError(
                "conversation management is not configured"
            )
        return self._conversations

    # --- transcribe / history / memory ---------------------------------------

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

    # --- reply ---------------------------------------------------------------

    async def reply(
        self,
        *,
        query: str,
        regenerate: bool = False,
        conversation_id: str | None = None,
    ) -> ConversationReply:
        if regenerate and self._history is not None:
            await self._history.delete_last_assistant()
        passages = await self._retriever.search(
            query=query,
            limit=self._max_sources,
        )
        prompt = await self._prompt_for(query=query, passages=passages)
        result = await self._chat_client.chat_completion_structured(
            model=self._chat_model,
            prompt=prompt,
        )
        reply = self._compose_reply(text=result.text, passages=passages)
        await self._remember(
            query=query,
            text=reply.text,
            regenerate=regenerate,
            citations=reply.citations,
            grounded=reply.grounded,
            citation_urls=reply.citation_urls,
            conversation_id=conversation_id,
        )
        return await self._with_audio(reply)

    async def stream_reply(
        self,
        *,
        query: str,
        regenerate: bool = False,
        conversation_id: str | None = None,
        generation_id: str | None = None,
    ) -> AsyncIterator[dict]:
        if regenerate and self._history is not None:
            await self._history.delete_last_assistant()
        try:
            yield {"type": "stage", "stage": "understanding"}
            yield {"type": "stage", "stage": "retrieving"}
            passages = await self._retriever.search(
                query=query,
                limit=self._max_sources,
            )
            yield {
                "type": "stage",
                "stage": "found_sources",
                "count": len(passages),
            }
            prompt = await self._prompt_for(query=query, passages=passages)
            full_text = ""
            async for token in self._chat_client.chat_completion_stream(
                model=self._chat_model,
                prompt=prompt,
            ):
                if generation_id is not None and self._generations.is_stopped(
                    generation_id
                ):
                    break
                full_text += token
                yield {"type": "token", "text": token}
            reply = self._compose_reply(text=full_text, passages=passages)
            yield {
                "type": "citations",
                "citations": list(reply.citations),
                "grounded": reply.grounded,
                "used_source_ids": list(reply.used_source_ids),
                "confidence": reply.confidence,
                "insufficient_context": reply.insufficient_context,
                "suggested_follow_up": reply.suggested_follow_up,
            }
            yield {"type": "done", "text": reply.text}
        except asyncio.CancelledError:
            raise
        except Exception as error:
            yield {
                "type": "error",
                "code": "generation_failed",
                "message": str(error),
                "retryable": False,
            }
            return
        # Persistence and TTS run after the text stream has completed; failures
        # must never affect the delivered text answer.
        try:
            await self._remember(
                query=query,
                text=reply.text,
                regenerate=regenerate,
                citations=reply.citations,
                grounded=reply.grounded,
                citation_urls=reply.citation_urls,
                conversation_id=conversation_id,
            )
        except Exception:
            pass
        if self._tts_client is not None:
            try:
                await self._tts_client.synthesize(text=reply.text)
            except Exception:
                pass

    async def _prompt_for(
        self,
        *,
        query: str,
        passages: tuple[RetrievedPassage, ...],
    ) -> str:
        if not passages:
            return await self._build_prompt(query=query)
        context = "\n\n".join(
            f"[{passage.title}]\n{passage.content}" for passage in passages
        )
        return await self._build_prompt(
            query=query,
            context=(
                "Answer using only the sources below. "
                "Cite each source title you use.\n\n"
                f"{context}"
            ),
        )

    def _compose_reply(
        self,
        *,
        text: str,
        passages: tuple[RetrievedPassage, ...],
    ) -> ConversationReply:
        structured = parse_structured_reply(text)
        if structured is not None:
            return self._reply_from_structured(
                structured,
                passages=passages,
            )
        normalized_reply = text.casefold()
        cited_passages = tuple(
            passage
            for passage in passages
            if passage.title.casefold() in normalized_reply
        )
        if cited_passages:
            return ConversationReply(
                text=text,
                citations=tuple(
                    passage.citation() for passage in cited_passages
                ),
                grounded=True,
                citation_urls=tuple(
                    passage.source_url for passage in cited_passages
                ),
            )
        return ConversationReply(
            text=text,
            citations=(),
            grounded=False,
            citation_urls=(),
        )

    def _reply_from_structured(
        self,
        structured: StructuredReply,
        *,
        passages: tuple[RetrievedPassage, ...],
    ) -> ConversationReply:
        valid_ids = {passage.document_id for passage in passages}
        used_ids = tuple(
            source_id
            for source_id in structured.used_source_ids
            if source_id in valid_ids
        )
        cited_passages = tuple(
            passage
            for passage in passages
            if passage.document_id in used_ids
        )
        if structured.insufficient_context or not passages:
            return ConversationReply(
                text=structured.answer,
                citations=(),
                grounded=False,
                citation_urls=(),
                used_source_ids=(),
                confidence=structured.confidence,
                insufficient_context=True,
                suggested_follow_up=structured.suggested_follow_up,
            )
        if cited_passages:
            return ConversationReply(
                text=structured.answer,
                citations=tuple(
                    passage.citation() for passage in cited_passages
                ),
                grounded=True,
                citation_urls=tuple(
                    passage.source_url for passage in cited_passages
                ),
                used_source_ids=used_ids,
                confidence=structured.confidence,
                insufficient_context=False,
                suggested_follow_up=structured.suggested_follow_up,
            )
        return ConversationReply(
            text=structured.answer,
            citations=(),
            grounded=False,
            citation_urls=(),
            used_source_ids=(),
            confidence=structured.confidence,
            insufficient_context=False,
            suggested_follow_up=structured.suggested_follow_up,
        )

    async def _build_prompt(
        self,
        *,
        query: str,
        context: str | None = None,
    ) -> str:
        sections: list[str] = []
        if context is not None:
            sections.append(context)
        if self._memory_service is not None:
            entries = await self._memory_service.load_for_prompt()
            if entries:
                lines = "\n".join(
                    f"- [{entry.type}] {entry.content}" for entry in entries
                )
                sections.append(f"Long-term memory:\n{lines}")
        elif self._memory_store is not None:
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
        conversation_id: str | None = None,
    ) -> None:
        if self._history is None:
            return
        if not regenerate:
            await self._history.append(
                role="user",
                content=query,
                conversation_id=conversation_id,
            )
            await self._maybe_title_conversation(conversation_id, query)
        await self._history.append(
            role="assistant",
            content=text,
            citations=citations,
            grounded=grounded,
            citation_urls=citation_urls,
            conversation_id=conversation_id,
        )
        if conversation_id is not None and self._conversations is not None:
            await self._conversations.set_last_message(conversation_id)
        if self._memory_service is not None:
            try:
                await self._memory_service.record(query=query, text=text)
            except Exception:
                pass
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

    async def _maybe_title_conversation(
        self,
        conversation_id: str | None,
        query: str,
    ) -> None:
        if (
            conversation_id is None
            or self._conversations is None
            or self._history is None
        ):
            return
        try:
            conversation = await self._conversations.get(conversation_id)
        except ConversationNotFoundError:
            return
        if conversation.title != DEFAULT_TITLE:
            return
        total_messages = await self._history.count(
            conversation_id=conversation_id
        )
        if total_messages == 1:
            await self._conversations.rename(
                conversation_id,
                title=_default_title(query),
            )

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
            used_source_ids=reply.used_source_ids,
            confidence=reply.confidence,
            insufficient_context=reply.insufficient_context,
            suggested_follow_up=reply.suggested_follow_up,
        )


def _default_title(query: str) -> str:
    cleaned = " ".join(query.split())
    return cleaned[:40] or DEFAULT_TITLE