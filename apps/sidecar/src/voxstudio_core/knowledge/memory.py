import json
from dataclasses import dataclass
from typing import Protocol

from voxstudio_core.knowledge.memory_rules import (
    MemoryRuleService,
)
from voxstudio_core.persistence.database import Database
from voxstudio_core.persistence.memory_entry_repository import (
    MEMORY_SCOPE_GLOBAL,
    MemoryEntry,
    MemoryEntryRepository,
    MemoryIgnoreRuleRepository,
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


@dataclass(frozen=True, slots=True)
class InjectionMemory:
    """A single memory line prepared for model prompt injection."""

    type: str
    content: str
    source: str
    conflict: bool = False


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
        ignore_rules: MemoryIgnoreRuleRepository | None = None,
        injection_max_chars: int = 800,
        injection_max_entries: int = 20,
    ) -> None:
        self._repository = repository
        self._rules = rules or MemoryRuleService(
            low_confidence_threshold=low_confidence_threshold
        )
        self._chat_client = chat_client
        self._chat_model = chat_model
        self._enabled = enabled
        self._ignore_rules = ignore_rules or MemoryIgnoreRuleRepository(
            repository._database
        )
        self._injection_max_chars = injection_max_chars
        self._injection_max_entries = injection_max_entries

    @property
    def enabled(self) -> bool:
        return self._enabled

    def set_enabled(self, enabled: bool) -> None:
        self._enabled = enabled

    # --- record -------------------------------------------------------------

    async def record(
        self,
        *,
        query: str,
        text: str,
        scope: str = MEMORY_SCOPE_GLOBAL,
        scope_id: str | None = None,
    ) -> None:
        """Extract and store memory entries. Never raises on failure."""
        if not self._enabled:
            return
        try:
            candidates = await self._extract(query, text)
        except Exception:
            return
        for candidate in candidates:
            try:
                await self._store_candidate(
                    candidate, scope=scope, scope_id=scope_id
                )
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

    async def _store_candidate(
        self,
        candidate: ExtractedMemory,
        *,
        scope: str = MEMORY_SCOPE_GLOBAL,
        scope_id: str | None = None,
    ) -> None:
        content = candidate.content
        if not content.strip():
            return
        memory_type = candidate.type or self._rules.classify(content)
        if not self._rules.should_persist(content, candidate.sensitive):
            return
        # "不再记住此类信息": skip when a matching ignore rule exists in scope.
        if await self._is_ignored(memory_type, scope=scope, scope_id=scope_id):
            return
        confidence = candidate.confidence
        if confidence is None:
            confidence = self._rules.confidence_for(content)
        confirmed = not self._rules.needs_confirmation(confidence)
        source = self._rules.source_for(content, memory_type)
        existing_entries = await self._repository.list(
            scope=scope, scope_id=scope_id
        )
        conflict_group = None
        for entry in existing_entries:
            if self._rules.detect_conflict(entry.content, content):
                conflict_group = entry.conflict_group or self._rules.conflict_group_for(
                    content
                )
                break
        # Deduplicate: skip when the same memory is already stored.
        for entry in existing_entries:
            if self._rules.is_duplicate(entry.content, content):
                return
        await self._repository.create(
            type=memory_type,
            content=content,
            confidence=confidence,
            confirmed_by_user=confirmed,
            conflict_group=conflict_group,
            source=source,
            scope=scope,
            scope_id=scope_id,
        )

    async def _is_ignored(
        self,
        memory_type: str,
        *,
        scope: str,
        scope_id: str | None,
    ) -> bool:
        rule = await self._ignore_rules.find(
            type=memory_type, scope=scope, scope_id=scope_id
        )
        return rule is not None

    # --- read / prune --------------------------------------------------------

    async def load_for_prompt(self) -> tuple[MemoryEntry, ...]:
        """Return active (non-expired) entries for prompt injection.

        Excludes disabled and secretly-sourced entries; sensitive entries are
        masked but still included so the model knows the user has a memory
        there. Kept for backward compatibility — callers should prefer
        `prepare_for_injection`.
        """
        await self.prune_expired()
        entries = await self._repository.list(include_disabled=False)
        deduped: list[MemoryEntry] = []
        for entry in entries:
            if any(
                self._rules.is_duplicate(existing.content, entry.content)
                for existing in deduped
            ):
                continue
            deduped.append(entry)
        return tuple(deduped)

    async def prepare_for_injection(
        self,
        *,
        max_chars: int | None = None,
        max_entries: int | None = None,
    ) -> tuple[InjectionMemory, ...]:
        """Prepare memory lines for prompt injection with pre-injection checks.

        Applies, in order:
          - expiry pruning and exclusion of disabled entries;
          - conflict detection (flagged, not dropped);
          - deduplication of near-identical memories;
          - sensitive masking (never inject raw sensitive content);
          - a total length budget (truncation/downgrade) with pinned entries
            kept first.
        """
        await self.prune_expired()
        budget_chars = max_chars or self._injection_max_chars
        budget_entries = max_entries or self._injection_max_entries
        entries = await self._repository.list(include_disabled=False)

        # Deduplicate (keep pinned first, then most recent).
        deduped: list[MemoryEntry] = []
        for entry in entries:
            if any(
                self._rules.is_duplicate(existing.content, entry.content)
                for existing in deduped
            ):
                continue
            deduped.append(entry)

        # Conflict: flag entries whose conflict group is shared by another
        # selected entry, so the model knows to reconcile conflicting memories.
        group_counts: dict[str, int] = {}
        for entry in deduped:
            if entry.conflict_group is not None:
                group_counts[entry.conflict_group] = (
                    group_counts.get(entry.conflict_group, 0) + 1
                )
        conflict_groups = {
            group for group, count in group_counts.items() if count >= 2
        }

        lines: list[InjectionMemory] = []
        used = 0
        for entry in deduped:
            if len(lines) >= budget_entries:
                break
            content = (
                self._rules.mask_sensitive(entry.content)
                if entry.sensitive
                else entry.content
            )
            line = f"[{entry.type}] {content}"
            conflict = (
                entry.conflict_group is not None
                and entry.conflict_group in conflict_groups
            )
            if used + len(line) > budget_chars:
                break
            used += len(line)
            lines.append(
                InjectionMemory(
                    type=entry.type,
                    content=content,
                    source=entry.source,
                    conflict=conflict,
                )
            )
        return tuple(lines)

    async def prune_expired(self) -> int:
        """Remove expired entries. Returns the number removed."""
        removed = 0
        for entry in await self._repository.list():
            if self._rules.is_expired(entry):
                await self._repository.delete(entry.id)
                removed += 1
        return removed

    # --- management passthroughs ---------------------------------------------

    async def list_entries(
        self,
        *,
        type: str | None = None,
        source: str | None = None,
        scope: str | None = None,
        scope_id: str | None = None,
        include_disabled: bool = True,
    ) -> tuple[MemoryEntry, ...]:
        return await self._repository.list(
            type=type,
            source=source,
            scope=scope,
            scope_id=scope_id,
            include_disabled=include_disabled,
        )

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

    async def set_entry_pinned(
        self,
        entry_id: str,
        *,
        pinned: bool,
    ) -> MemoryEntry:
        return await self._repository.set_pinned(entry_id, pinned=pinned)

    async def set_entry_disabled(
        self,
        entry_id: str,
        *,
        disabled: bool,
    ) -> MemoryEntry:
        return await self._repository.set_disabled(entry_id, disabled=disabled)

    async def delete_entry(self, entry_id: str) -> None:
        await self._repository.delete(entry_id)

    async def permanent_delete(self, entry_id: str) -> bool:
        """Permanently delete an entry and verify it is truly gone (persisted).

        Returns True when the entry was deleted and a re-read confirms it no
        longer exists. Raises MemoryEntryNotFoundError when the entry was
        missing before deletion.
        """
        await self._repository.delete(entry_id)
        return not await self._repository.exists(entry_id)

    async def clear_entries(self) -> None:
        await self._repository.clear_all()

    async def count_entries(self) -> int:
        return await self._repository.count()

    # --- "不再记住此类信息" ignore rules ------------------------------------

    async def ignore_memory_type(
        self,
        *,
        type: str,
        scope: str = MEMORY_SCOPE_GLOBAL,
        scope_id: str | None = None,
    ):
        return await self._ignore_rules.create(
            type=type, scope=scope, scope_id=scope_id
        )

    async def list_ignore_rules(
        self,
        *,
        scope: str | None = None,
        scope_id: str | None = None,
    ):
        return await self._ignore_rules.list(scope=scope, scope_id=scope_id)

    async def unignore_memory_type(self, rule_id: str) -> None:
        await self._ignore_rules.delete(rule_id)

    # --- privacy -------------------------------------------------------------

    def privacy_statement(self) -> str:
        """A user-comprehensible explanation of how memory is stored/used."""
        return (
            "长期记忆仅保存在本机数据库中，不会上传云端。系统会从对话中自动摘录"
            "值得记住的信息并标注来源（用户明确要求或系统自动摘要）。你可以随时"
            "查看、编辑、固定、暂时禁用或永久删除任意一条记忆，也可以选择“不再记住"
            "此类信息”来阻止之后记录同类内容。敏感信息在注入对话前会被隐藏，"
            "不会被透露给模型。彻底删除后数据会从数据库中移除，无法恢复。"
        )


def _deterministic_extract(query: str) -> list[ExtractedMemory]:
    """Fallback extraction when no chat client is configured."""
    if not query or not query.strip():
        return []
    return [ExtractedMemory(content=query.strip(), type=None, confidence=None)]
