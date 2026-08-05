from __future__ import annotations

import re
from collections.abc import Sequence
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


#: Default sensitive-data patterns that are never persisted: passwords/tokens,
#: credentials, ID-card numbers, phone numbers and general "secret" phrasing.
#: Each entry is (label, compiled regex). Users may override via the
#: ``sensitive_patterns`` constructor argument.
_SENSITIVE_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    (
        "password",
        re.compile(
            r"(密码|口令|password|passwd|pwd)\s*[=:：]?\s*[\w!@#$%^&*.\-]{4,}",
            re.IGNORECASE,
        ),
    ),
    (
        "token",
        re.compile(
            r"(token|secret|api[_-]?key|access[_-]?key|app[_-]?secret|"
            r"refresh[_-]?token|access[_-]?token)\s*[=:：]?\s*[\w.\-]{6,}",
            re.IGNORECASE,
        ),
    ),
    (
        "id_card",
        re.compile(r"\b\d{17}[\dXx]\b"),
    ),
    (
        "phone",
        re.compile(r"(?<!\d)1[3-9]\d{9}(?!\d)"),
    ),
    (
        "credit_card",
        re.compile(r"\b(?:\d[ -]?){13,19}\b"),
    ),
    (
        "secret_phrase",
        re.compile(
            r"(?:我的|我的[bB]ank|银行卡|信用卡|账户|账号|用户名|登录)?"
            r"(密码|卡号|账号|用户名|token|口令|密钥|密钥内容)",
        ),
    ),
)


class MemoryRuleService:
    """Deterministic classification and write rules for memory entries."""

    def __init__(
        self,
        *,
        low_confidence_threshold: float = 0.5,
        sensitive_patterns: Sequence[re.Pattern[str]] | None = None,
    ) -> None:
        self._low_confidence_threshold = low_confidence_threshold
        # Allow user-supplied patterns to replace the defaults (privacy rules
        # are user-configurable). Falls back to the built-in defaults.
        if sensitive_patterns is not None:
            self._sensitive_patterns = tuple(sensitive_patterns)
        else:
            self._sensitive_patterns = tuple(
                pattern for _, pattern in _SENSITIVE_PATTERNS
            )

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
        """Sensitive content is not persisted by default.

        A memory is rejected when it is flagged sensitive by extraction OR when
        the content itself matches a sensitive-data pattern (password, token,
        ID number, phone number, …). The pattern set is user-configurable via
        the constructor's ``sensitive_patterns`` argument.
        """
        if not content or not content.strip():
            return False
        if sensitive:
            return False
        if self.is_sensitive(content):
            return False
        return True

    def is_sensitive(self, content: str) -> bool:
        """True when the content contains a sensitive-data pattern."""
        if not content:
            return False
        return any(pattern.search(content) for pattern in self._sensitive_patterns)

    def source_for(self, content: str, memory_type: str) -> str:
        """Whether a memory comes from the user explicitly (user) or from
        automatic summarisation (system).

        Explicit-request statements ("请记住…", "remind me…") are treated as
        user-sourced; everything else is a system auto-summary.
        """
        if memory_type == MEMORY_TYPE_EXPLICIT_REQUEST:
            return "user"
        normalized = (content or "").casefold()
        for keyword in (
            "请记住",
            "请务必记住",
            "please remember",
            "remind me",
            "please note",
        ):
            if keyword in normalized:
                return "user"
        return "system"

    def is_duplicate(self, existing: str, new: str) -> bool:
        """True when `new` adds nothing beyond `existing` (near-identical).

        Used to deduplicate before persistence and before injection. A real
        conflict (polarity flip) is NOT a duplicate.
        """
        existing_tokens = _tokens(existing)
        new_tokens = _tokens(new)
        if not existing_tokens or not new_tokens:
            return False
        if existing_tokens == new_tokens:
            return True
        overlap = len(existing_tokens & new_tokens) / len(new_tokens)
        return overlap >= 0.85 and not self.detect_conflict(existing, new)

    def mask_sensitive(self, content: str) -> str:
        """Replace a sensitive memory with a safe placeholder for injection."""
        if not content or not content.strip():
            return content
        return "[已隐藏的敏感信息]"

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
