import json
from dataclasses import dataclass
from typing import Protocol

from voxstudio_core.knowledge.memory_rules import (
    MemoryRuleService,
)
from voxstudio_core.persistence.database import Database
from voxstudio_core.persistence.memory_entry_repository import (
    MemoryEntry,
    MemoryEntryRepository,
)


class ChatCompletionPort(Protocol):
    async def chat_completion(self, *, model: str, prompt: str) -> object: ...


@dataclass(frozen=True, slots=True)
class ExtractedMemory:
    content: str
    type: str | None = None
    confidence: float | None = None
    sensitive: bool = False


@dataclass(frozen=True, slots=True)
class ConversationMemory:
    summary: str
    created_at: str | None = None


class ConversationMemoryStore:
    def __init__(self, database: Database) -> None:
        self._database = database

    async def load_latest(self) -> ConversationMemory | None:
        async with self._database.transaction(immediate=False) as connection:
            async with connection.execute(
                """
                SELECT summary, created_at
                FROM conversation_memory
                ORDER BY id DESC
                LIMIT 1
                """
            ) as cursor:
                row = await cursor.fetchone()
        if row is None:
            return None
        return ConversationMemory(
            summary=row["summary"],
            created_at=row["created_at"],
        )

    async def save(self, *, summary: str) -> None:
        if not summary.strip():
            raise ValueError("memory summary must not be empty")
        async with self._database.transaction() as connection:
            await connection.execute(
                "INSERT INTO conversation_memory (summary) VALUES (?)",
                (summary.strip(),),
            )

    async def clear(self) -> None:
        async with self._database.transaction() as connection:
            await connection.execute("DELETE FROM conversation_memory")


_MEMORY_EXTRACTION_PROMPT = (
    "Extract any long-term memory entries worth remembering from the "
    "conversation below. Return ONLY a JSON array (no markdown, no code "
    "fences). Each element is an object with exactly these keys: "
    "\"content\" (string), \"type\" (one of: user_fact, preference, goal, "
    "ongoing, relationship, habit, explicit_request), \"confidence\" "
    "(number 0-1), \"sensitive\" (boolean). Return an empty array [] when "
    "there is nothing durable to remember.\n\n{transcript}"
)


class MemoryService:
    """Structured long-term memory: extract, classify, apply rules, store."""

    def __init__(
        self,
        *,
        repository: MemoryEntryRepository,
        rules: MemoryRuleService | None = None,
        chat_client: ChatCompletionPort | None = None,
        chat_model: str | None = None,
        low_confidence_threshold: float = 0.5,
        enabled: bool = True,
    ) -> None:
        self._repository = repository
        self._rules = rules or MemoryRuleService(
            low_confidence_threshold=low_confidence_threshold
        )
        self._chat_client = chat_client
        self._chat_model = chat_model
        self._enabled = enabled

    @property
    def enabled(self) -> bool:
        return self._enabled

    def set_enabled(self, enabled: bool) -> None:
        self._enabled = enabled

    # --- record -------------------------------------------------------------

    async def record(self, *, query: str, text: str) -> None:
        """Extract and store memory entries. Never raises on failure."""
        if not self._enabled:
            return
        try:
            candidates = await self._extract(query, text)
        except Exception:
            return
        for candidate in candidates:
            try:
                await self._store_candidate(candidate)
            except Exception:
                continue

    async def _extract(
        self,
        query: str,
        text: str,
    ) -> list[ExtractedMemory]:
        if self._chat_client is None or not self._chat_model:
            return _deterministic_extract(query)
        transcript = f"user: {query}\nassistant: {text}"
        reply = await self._chat_client.chat_completion(
            model=self._chat_model,
            prompt=_MEMORY_EXTRACTION_PROMPT.format(transcript=transcript),
        )
        raw = getattr(reply, "text", None)
        if not isinstance(raw, str):
            return []
        try:
            data = json.loads(raw)
        except (TypeError, ValueError):
            return []
        if not isinstance(data, list):
            return []
        candidates: list[ExtractedMemory] = []
        for item in data:
            if not isinstance(item, dict):
                continue
            content = item.get("content")
            if not isinstance(content, str) or not content.strip():
                continue
            memory_type = item.get("type")
            confidence = item.get("confidence")
            sensitive = item.get("sensitive")
            candidates.append(
                ExtractedMemory(
                    content=content.strip(),
                    type=(
                        memory_type
                        if isinstance(memory_type, str) and memory_type
                        else None
                    ),
                    confidence=(
                        float(confidence)
                        if isinstance(confidence, (int, float))
                        and not isinstance(confidence, bool)
                        else None
                    ),
                    sensitive=(
                        bool(sensitive) if isinstance(sensitive, bool) else False
                    ),
                )
            )
        return candidates

    async def _store_candidate(self, candidate: ExtractedMemory) -> None:
        content = candidate.content
        if not content.strip():
            return
        memory_type = candidate.type or self._rules.classify(content)
        if not self._rules.should_persist(content, candidate.sensitive):
            return
        confidence = candidate.confidence
        if confidence is None:
            confidence = self._rules.confidence_for(content)
        confirmed = not self._rules.needs_confirmation(confidence)
        conflict_group = None
        for entry in await self._repository.list():
            if self._rules.detect_conflict(entry.content, content):
                conflict_group = entry.conflict_group or self._rules.conflict_group_for(
                    content
                )
                break
        await self._repository.create(
            type=memory_type,
            content=content,
            confidence=confidence,
            confirmed_by_user=confirmed,
            conflict_group=conflict_group,
        )

    # --- read / prune --------------------------------------------------------

    async def load_for_prompt(self) -> tuple[MemoryEntry, ...]:
        """Return active (non-expired) entries for prompt injection."""
        await self.prune_expired()
        return await self._repository.list()

    async def prune_expired(self) -> int:
        """Remove expired entries. Returns the number removed."""
        removed = 0
        for entry in await self._repository.list():
            if self._rules.is_expired(entry):
                await self._repository.delete(entry.id)
                removed += 1
        return removed

    # --- management passthroughs ---------------------------------------------

    async def list_entries(self, *, type: str | None = None) -> tuple[MemoryEntry, ...]:
        return await self._repository.list(type=type)

    async def get_entry(self, entry_id: str) -> MemoryEntry:
        return await self._repository.get(entry_id)

    async def update_entry_content(
        self,
        entry_id: str,
        *,
        content: str,
    ) -> MemoryEntry:
        return await self._repository.update_content(entry_id, content=content)

    async def set_entry_confirmed(
        self,
        entry_id: str,
        *,
        confirmed: bool,
    ) -> MemoryEntry:
        return await self._repository.set_confirmed(entry_id, confirmed=confirmed)

    async def set_entry_sensitive(
        self,
        entry_id: str,
        *,
        sensitive: bool,
    ) -> MemoryEntry:
        return await self._repository.set_sensitive(entry_id, sensitive=sensitive)

    async def delete_entry(self, entry_id: str) -> None:
        await self._repository.delete(entry_id)

    async def clear_entries(self) -> None:
        await self._repository.clear_all()

    async def count_entries(self) -> int:
        return await self._repository.count()


def _deterministic_extract(query: str) -> list[ExtractedMemory]:
    """Fallback extraction when no chat client is configured."""
    if not query or not query.strip():
        return []
    return [ExtractedMemory(content=query.strip(), type=None, confidence=None)]
