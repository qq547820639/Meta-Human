from __future__ import annotations

import re
from datetime import UTC, datetime
from hashlib import sha256

MEMORY_TYPE_USER_FACT = "user_fact"
MEMORY_TYPE_PREFERENCE = "preference"
MEMORY_TYPE_GOAL = "goal"
MEMORY_TYPE_ONGOING = "ongoing"
MEMORY_TYPE_RELATIONSHIP = "relationship"
MEMORY_TYPE_HABIT = "habit"
MEMORY_TYPE_EXPLICIT_REQUEST = "explicit_request"

MEMORY_TYPES = (
    MEMORY_TYPE_USER_FACT,
    MEMORY_TYPE_PREFERENCE,
    MEMORY_TYPE_GOAL,
    MEMORY_TYPE_ONGOING,
    MEMORY_TYPE_RELATIONSHIP,
    MEMORY_TYPE_HABIT,
    MEMORY_TYPE_EXPLICIT_REQUEST,
)

# Ordered keyword rules so the first matching category wins. Deterministic and
# easy to test.
_CLASSIFICATION_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    (
        MEMORY_TYPE_EXPLICIT_REQUEST,
        (
            "请记住",
            "请帮我",
            "请务必",
            "提醒我",
            "please remember",
            "please make sure",
            "remind me",
            "please note",
        ),
    ),
    (
        MEMORY_TYPE_PREFERENCE,
        (
            "我喜欢",
            "我偏好",
            "比起",
            "更喜欢",
            "prefer",
            "i like",
            "i love",
            "i prefer",
        ),
    ),
    (
        MEMORY_TYPE_GOAL,
        (
            "我的目标",
            "我想达成",
            "我的计划",
            "打算",
            "goal",
            "i want to",
            "i intend",
            "my plan",
        ),
    ),
    (
        MEMORY_TYPE_ONGOING,
        (
            "正在进行",
            "正在做",
            "在处理",
            "working on",
            "in progress",
            "ongoing",
        ),
    ),
    (
        MEMORY_TYPE_RELATIONSHIP,
        (
            "我的朋友",
            "我的家人",
            "我妈妈",
            "我爸爸",
            "我的同事",
            "relationship",
            "my friend",
            "my family",
        ),
    ),
    (
        MEMORY_TYPE_HABIT,
        (
            "我的习惯",
            "每天",
            "经常",
            "habit",
            "usually",
            "every day",
        ),
    ),
)


class MemoryRuleService:
    """Deterministic classification and write rules for memory entries."""

    def __init__(self, *, low_confidence_threshold: float = 0.5) -> None:
        self._low_confidence_threshold = low_confidence_threshold

    def classify(self, text: str) -> str:
        """Classify a memory statement into a fixed memory type."""
        if not text or not text.strip():
            return MEMORY_TYPE_USER_FACT
        normalized = text.casefold()
        for memory_type, keywords in _CLASSIFICATION_RULES:
            if any(keyword in normalized for keyword in keywords):
                return memory_type
        return MEMORY_TYPE_USER_FACT

    def should_persist(self, content: str, sensitive: bool) -> bool:
        """Sensitive content is not persisted by default."""
        if not content or not content.strip():
            return False
        if sensitive:
            return False
        return True

    def detect_conflict(self, existing: str, new: str) -> bool:
        """Conflicting memories are marked rather than overwritten.

        A conflict is a high-overlap statement of the same subject whose
        polarity/negation differs (e.g. "likes coffee" vs "dislikes coffee").
        """
        existing_tokens = _tokens(existing)
        new_tokens = _tokens(new)
        if not existing_tokens or not new_tokens:
            return False
        if existing_tokens == new_tokens:
            return False
        overlap = len(existing_tokens & new_tokens) / len(new_tokens)
        if overlap < 0.5:
            return False
        return _has_negation(existing) != _has_negation(new)

    def is_expired(self, entry) -> bool:
        """An entry is expired when its expires_at has passed."""
        if entry is None or entry.expires_at is None:
            return False
        try:
            expires = datetime.fromisoformat(entry.expires_at)
        except ValueError:
            return False
        if expires.tzinfo is None or expires.utcoffset() is None:
            expires = expires.replace(tzinfo=UTC)
        return expires <= datetime.now(UTC)

    def confidence_for(self, content: str) -> float:
        """Deterministic confidence based on statement length."""
        if not content or not content.strip():
            return 0.0
        length = len(content.strip())
        if length >= 40:
            return 0.9
        if length >= 20:
            return 0.7
        if length >= 10:
            return 0.5
        return 0.3

    def needs_confirmation(self, confidence: float) -> bool:
        """Low-confidence entries require confirmation before being trusted."""
        return confidence < self._low_confidence_threshold

    def conflict_group_for(self, content: str) -> str:
        digest = sha256(content.strip().casefold().encode("utf-8")).hexdigest()[:12]
        return f"conflict-{digest}"


def _tokens(text: str) -> set[str]:
    if not text:
        return set()
    normalized = text.casefold()
    return set(
        re.findall(r"[a-z0-9]+|[\u4e00-\u9fff]", normalized)
    )


_NEGATION_MARKERS = (
    "不",
    "没",
    "非",
    "讨厌",
    "恨",
    "not",
    "never",
    "don't",
    "doesn't",
    "didn't",
    "dislike",
    "hate",
)


def _has_negation(text: str) -> bool:
    normalized = text.casefold()
    return any(marker in normalized for marker in _NEGATION_MARKERS)