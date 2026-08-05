from datetime import UTC, datetime, timedelta

import pytest

from voxstudio_core.knowledge.memory_rules import (
    MEMORY_TYPE_EXPLICIT_REQUEST,
    MEMORY_TYPE_GOAL,
    MEMORY_TYPE_HABIT,
    MEMORY_TYPE_ONGOING,
    MEMORY_TYPE_PREFERENCE,
    MEMORY_TYPE_RELATIONSHIP,
    MEMORY_TYPE_USER_FACT,
    MemoryRuleService,
)
from voxstudio_core.persistence.memory_entry_repository import MemoryEntry


@pytest.fixture
def rules() -> MemoryRuleService:
    return MemoryRuleService()


def test_classify_defaults_to_user_fact(rules: MemoryRuleService) -> None:
    assert rules.classify("外骨骼的穿戴步骤是后入式") == MEMORY_TYPE_USER_FACT
    assert rules.classify("") == MEMORY_TYPE_USER_FACT


def test_classify_recognizes_categories(rules: MemoryRuleService) -> None:
    assert rules.classify("我喜欢喝咖啡") == MEMORY_TYPE_PREFERENCE
    assert rules.classify("我的目标是成为一名工程师") == MEMORY_TYPE_GOAL
    assert rules.classify("我正在处理项目") == MEMORY_TYPE_ONGOING
    assert rules.classify("我的朋友叫小明") == MEMORY_TYPE_RELATIONSHIP
    assert rules.classify("我每天都会跑步") == MEMORY_TYPE_HABIT
    assert rules.classify("请记住我的生日") == MEMORY_TYPE_EXPLICIT_REQUEST


def test_should_persist_skips_sensitive(rules: MemoryRuleService) -> None:
    assert rules.should_persist("普通内容", sensitive=False) is True
    assert rules.should_persist("敏感内容", sensitive=True) is False
    assert rules.should_persist("   ", sensitive=False) is False


def test_detect_conflict_marks_real_conflicts(rules: MemoryRuleService) -> None:
    assert rules.detect_conflict("用户喜欢咖啡", "用户不喜欢咖啡") is True
    assert rules.detect_conflict("User likes coffee", "User dislikes coffee") is True


def test_detect_conflict_ignores_identical_or_unrelated(
    rules: MemoryRuleService,
) -> None:
    assert rules.detect_conflict("用户喜欢咖啡", "用户喜欢咖啡") is False
    assert rules.detect_conflict("用户喜欢咖啡", "用户喜欢跑步") is False


def test_is_expired(rules: MemoryRuleService) -> None:
    past = datetime.now(UTC) - timedelta(seconds=5)
    future = datetime.now(UTC) + timedelta(days=1)
    expired = MemoryEntry(
        id="1",
        type="user_fact",
        content="x",
        source_message_id=None,
        confidence=None,
        created_at="2026-01-01T00:00:00Z",
        updated_at="2026-01-01T00:00:00Z",
        last_used_at=None,
        confirmed_by_user=False,
        sensitive=False,
        expires_at=past.isoformat(),
        conflict_group=None,
    )
    not_expired = MemoryEntry(
        id="2",
        type="user_fact",
        content="x",
        source_message_id=None,
        confidence=None,
        created_at="2026-01-01T00:00:00Z",
        updated_at="2026-01-01T00:00:00Z",
        last_used_at=None,
        confirmed_by_user=False,
        sensitive=False,
        expires_at=future.isoformat(),
        conflict_group=None,
    )
    never = MemoryEntry(
        id="3",
        type="user_fact",
        content="x",
        source_message_id=None,
        confidence=None,
        created_at="2026-01-01T00:00:00Z",
        updated_at="2026-01-01T00:00:00Z",
        last_used_at=None,
        confirmed_by_user=False,
        sensitive=False,
        expires_at=None,
        conflict_group=None,
    )
    assert rules.is_expired(expired) is True
    assert rules.is_expired(not_expired) is False
    assert rules.is_expired(never) is False


def test_confidence_for_is_deterministic(rules: MemoryRuleService) -> None:
    assert rules.confidence_for("") == 0.0
    assert rules.confidence_for("短") == 0.3
    assert rules.confidence_for("这是一个长度为十五字符的句子") == 0.5
    assert rules.confidence_for("a" * 25) == 0.7
    assert rules.confidence_for("a" * 45) == 0.9


def test_needs_confirmation(rules: MemoryRuleService) -> None:
    assert rules.needs_confirmation(0.3) is True
    assert rules.needs_confirmation(0.8) is False


def test_source_for_distinguishes_user_vs_system(rules: MemoryRuleService) -> None:
    assert rules.source_for("请记住我的生日", MEMORY_TYPE_EXPLICIT_REQUEST) == "user"
    assert rules.source_for("请记住我喜欢咖啡", MEMORY_TYPE_PREFERENCE) == "user"
    assert (
        rules.source_for("please remember my birthday", MEMORY_TYPE_USER_FACT)
        == "user"
    )
    # A plain auto-summarised preference is a system memory.
    assert rules.source_for("用户喜欢咖啡", MEMORY_TYPE_PREFERENCE) == "system"
    assert rules.source_for("用户的名字叫小明", MEMORY_TYPE_USER_FACT) == "system"


def test_is_duplicate_detects_near_identical(rules: MemoryRuleService) -> None:
    assert rules.is_duplicate("用户喜欢咖啡", "用户喜欢咖啡") is True
    assert rules.is_duplicate("用户喜欢和咖啡", "用户喜欢咖啡") is True
    # A real conflict (polarity flip) is not a duplicate.
    assert rules.is_duplicate("用户喜欢咖啡", "用户不喜欢咖啡") is False
    # Unrelated statements are not duplicates.
    assert rules.is_duplicate("用户喜欢咖啡", "用户喜欢跑步") is False


def test_mask_sensitive_hides_content(rules: MemoryRuleService) -> None:
    assert "银行卡" not in rules.mask_sensitive("我的银行卡密码是123456")
    assert rules.mask_sensitive("   ") == "   "


def test_should_persist_rejects_sensitive_patterns(rules: MemoryRuleService) -> None:
    # Passwords / tokens / credentials embedded in content are never persisted.
    assert rules.should_persist("我的电脑密码是 hunter2", sensitive=False) is False
    assert rules.should_persist("access_token: abc123xyz", sensitive=False) is False
    assert rules.should_persist("api_key 8f3a9c2e1b7d", sensitive=False) is False
    # ID-card / phone / generic secret phrasing are also rejected.
    assert rules.should_persist("身份证号 110101199003077891", sensitive=False) is False
    assert rules.should_persist("我的手机号是 13812345678", sensitive=False) is False
    assert (
        rules.should_persist("我的银行卡号是 6222020200112233445", sensitive=False)
        is False
    )
    # Ordinary content is still persisted.
    assert rules.should_persist("用户喜欢在早上喝咖啡", sensitive=False) is True


def test_is_sensitive_detects_embedded_secrets(rules: MemoryRuleService) -> None:
    assert rules.is_sensitive("密码：abc123") is True
    assert rules.is_sensitive("token=eyJhbGciOi") is True
    assert rules.is_sensitive("普通的生活习惯描述") is False


def test_sensitive_patterns_are_user_configurable() -> None:
    import re

    custom = MemoryRuleService(
        sensitive_patterns=[re.compile(r"公司机密|内部编号\d+")]
    )
    # Custom pattern governs; a default (password) pattern is no longer active.
    assert custom.is_sensitive("内部编号8842") is True
    assert custom.is_sensitive("我的电脑密码是 hunter2") is False
    assert custom.should_persist("内部编号8842", sensitive=False) is False
    assert custom.should_persist("我的电脑密码是 hunter2", sensitive=False) is True
