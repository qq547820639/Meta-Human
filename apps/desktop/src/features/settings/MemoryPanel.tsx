import { useEffect, useState } from "react";

import SettingsPanel from "./SettingsPanel";
import {
  MEMORY_SOURCES,
  MEMORY_TYPES,
  MemoryEntry,
  MemoryIgnoreRule,
  clearMemoryEntries,
  createMemoryIgnoreRule,
  deleteMemoryEntry,
  deleteMemoryIgnoreRule,
  getMemoryPrivacyStatement,
  listMemoryEntries,
  listMemoryIgnoreRules,
  memoryScopeLabel,
  memorySourceLabel,
  memoryTypeLabel,
  permanentDeleteMemoryEntry,
  updateMemoryEntry,
} from "../memory/memoryClient";

interface MemoryPanelProps {
  readonly setStatus: (value: string | null) => void;
  readonly setError: (value: string | null) => void;
}

function formatTime(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export default function MemoryPanel({ setStatus, setError }: MemoryPanelProps) {
  const [memoryEntries, setMemoryEntries] = useState<MemoryEntry[]>([]);
  const [memoryTypeFilter, setMemoryTypeFilter] = useState<string>("");
  const [memorySourceFilter, setMemorySourceFilter] = useState<string>("");
  const [ignoreRules, setIgnoreRules] = useState<MemoryIgnoreRule[]>([]);
  const [privacyStatement, setPrivacyStatement] = useState<string>("");
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const [editingMemoryId, setEditingMemoryId] = useState<string | null>(null);
  const [editingMemoryContent, setEditingMemoryContent] = useState("");
  const [confirmingMemoryId, setConfirmingMemoryId] = useState<string | null>(
    null,
  );
  const [confirmingMemoryClear, setConfirmingMemoryClear] = useState(false);

  useEffect(() => {
    let active = true;
    setMemoryLoading(true);
    listMemoryEntries(memoryTypeFilter || undefined, {
      source: memorySourceFilter || undefined,
    })
      .then((response) => {
        if (active) setMemoryEntries([...response.entries]);
      })
      .catch(() => {
        if (active) setMemoryError("无法读取长期记忆。");
      })
      .finally(() => {
        if (active) setMemoryLoading(false);
      });
    return () => {
      active = false;
    };
  }, [memoryTypeFilter, memorySourceFilter]);

  useEffect(() => {
    let active = true;
    listMemoryIgnoreRules()
      .then((response) => {
        if (active) setIgnoreRules([...response.rules]);
      })
      .catch(() => {
        /* ignore rules are non-critical */
      });
    getMemoryPrivacyStatement()
      .then((statement) => {
        if (active) setPrivacyStatement(statement);
      })
      .catch(() => {
        /* privacy statement is non-critical */
      });
    return () => {
      active = false;
    };
  }, []);

  async function handleSaveMemory() {
    if (!editingMemoryId || !editingMemoryContent.trim()) return;
    setError(null);
    setMemoryError(null);
    try {
      await updateMemoryEntry(editingMemoryId, {
        content: editingMemoryContent.trim(),
      });
      setMemoryEntries((entries) =>
        entries.map((entry) =>
          entry.id === editingMemoryId
            ? { ...entry, content: editingMemoryContent.trim() }
            : entry,
        ),
      );
      setEditingMemoryId(null);
      setEditingMemoryContent("");
      setStatus("长期记忆已更新。");
    } catch {
      setMemoryError("无法更新长期记忆。");
    }
  }

  async function handleConfirmMemory(entry: MemoryEntry) {
    setMemoryError(null);
    try {
      await updateMemoryEntry(entry.id, { confirmed: true });
      setMemoryEntries((entries) =>
        entries.map((item) =>
          item.id === entry.id ? { ...item, confirmed_by_user: true } : item,
        ),
      );
      setStatus("该记忆已确认。");
    } catch {
      setMemoryError("无法更新记忆状态。");
    }
  }

  async function handleRejectMemory(entry: MemoryEntry) {
    setMemoryError(null);
    try {
      await updateMemoryEntry(entry.id, { reject: true });
      setMemoryEntries((entries) =>
        entries.filter((item) => item.id !== entry.id),
      );
      setStatus("该记忆已拒绝并删除。");
    } catch {
      setMemoryError("无法删除记忆。");
    }
  }

  async function handleTogglePin(entry: MemoryEntry) {
    setMemoryError(null);
    try {
      const updated = await updateMemoryEntry(entry.id, {
        pinned: !entry.pinned,
      });
      setMemoryEntries((entries) =>
        entries.map((item) => (item.id === entry.id ? updated : item)),
      );
      setStatus(updated.pinned ? "该记忆已固定。取消固定可随时恢复。" : "已取消固定。");
    } catch {
      setMemoryError("无法更新固定状态。");
    }
  }

  async function handleToggleDisabled(entry: MemoryEntry) {
    setMemoryError(null);
    try {
      const updated = await updateMemoryEntry(entry.id, {
        disabled: !entry.disabled,
      });
      setMemoryEntries((entries) =>
        entries.map((item) => (item.id === entry.id ? updated : item)),
      );
      setStatus(updated.disabled ? "该记忆已暂时禁用，注入时不会使用。" : "该记忆已恢复。");
    } catch {
      setMemoryError("无法更新记忆状态。");
    }
  }

  async function handlePermanentDelete(entry: MemoryEntry) {
    if (confirmingMemoryId !== entry.id) {
      setConfirmingMemoryId(entry.id);
      window.setTimeout(() => setConfirmingMemoryId(null), 3000);
      return;
    }
    setMemoryError(null);
    try {
      const result = await permanentDeleteMemoryEntry(entry.id);
      setMemoryEntries((entries) =>
        entries.filter((item) => item.id !== entry.id),
      );
      setConfirmingMemoryId(null);
      setStatus(
        result.verified
          ? "该记忆已彻底删除，并已确认从数据库中移除。"
          : "该记忆已删除，但删除验证未通过。",
      );
    } catch {
      setMemoryError("无法彻底删除记忆。");
    }
  }

  async function handleIgnoreType(entry: MemoryEntry) {
    setMemoryError(null);
    try {
      await createMemoryIgnoreRule(entry.type);
      const response = await listMemoryIgnoreRules();
      setIgnoreRules([...response.rules]);
      setStatus(`已设为「不再记住此类信息」：${memoryTypeLabel(entry.type)}。`);
    } catch {
      setMemoryError("无法设置「不再记住此类信息」。");
    }
  }

  async function handleUnignore(rule: MemoryIgnoreRule) {
    setMemoryError(null);
    try {
      await deleteMemoryIgnoreRule(rule.id);
      setIgnoreRules((rules) => rules.filter((item) => item.id !== rule.id));
      setStatus(`已恢复记住：${memoryTypeLabel(rule.type)}。`);
    } catch {
      setMemoryError("无法移除「不再记住此类信息」。");
    }
  }

  async function handleDeleteMemory(entry: MemoryEntry) {
    if (confirmingMemoryId !== entry.id) {
      setConfirmingMemoryId(entry.id);
      return;
    }
    setMemoryError(null);
    try {
      await deleteMemoryEntry(entry.id);
      setMemoryEntries((entries) =>
        entries.filter((item) => item.id !== entry.id),
      );
      setConfirmingMemoryId(null);
      setStatus("该记忆已删除。");
    } catch {
      setMemoryError("无法删除记忆。");
    }
  }

  async function handleClearMemory() {
    if (!confirmingMemoryClear) {
      setConfirmingMemoryClear(true);
      window.setTimeout(() => setConfirmingMemoryClear(false), 3000);
      return;
    }
    setMemoryError(null);
    try {
      await clearMemoryEntries();
      setMemoryEntries([]);
      setConfirmingMemoryClear(false);
      setStatus("长期记忆已清空。");
    } catch {
      setMemoryError("无法清空长期记忆。");
    }
  }

  return (
    <SettingsPanel title="会话与记忆">
      <p>长期记忆</p>
      {memoryLoading ? <p role="status">正在读取长期记忆…</p> : null}
      {memoryError ? <p role="alert">{memoryError}</p> : null}
      <label>
        记忆类型
        <select
          value={memoryTypeFilter}
          onChange={(event) => setMemoryTypeFilter(event.target.value)}
          disabled={memoryLoading}
        >
          <option value="">全部</option>
          {MEMORY_TYPES.map((type) => (
            <option key={type} value={type}>
              {memoryTypeLabel(type)}
            </option>
          ))}
        </select>
      </label>
      <label>
        来源
        <select
          value={memorySourceFilter}
          onChange={(event) => setMemorySourceFilter(event.target.value)}
          disabled={memoryLoading}
        >
          <option value="">全部来源</option>
          {MEMORY_SOURCES.map((source) => (
            <option key={source} value={source}>
              {memorySourceLabel(source)}
            </option>
          ))}
        </select>
      </label>
      {memoryEntries.length === 0 && !memoryLoading ? (
        <p>暂无记忆。</p>
      ) : (
        <ul>
          {memoryEntries.map((entry) => (
            <li key={entry.id}>
              <span>{memoryTypeLabel(entry.type)}</span>
              <span>（{memorySourceLabel(entry.source)}）</span>
              <span>（{memoryScopeLabel(entry.scope)}）</span>
              {entry.pinned ? <span>（已固定）</span> : null}
              {entry.disabled ? <span>（已禁用）</span> : null}
              {entry.sensitive ? <span>（敏感）</span> : null}
              {entry.conflict_group ? <span>（冲突）</span> : null}
              {!entry.confirmed_by_user ? <span>（待确认）</span> : null}
              {entry.created_at ? (
                <span>（创建于 {formatTime(entry.created_at)}）</span>
              ) : null}
              {editingMemoryId === entry.id ? (
                <label>
                  内容
                  <textarea
                    value={editingMemoryContent}
                    onChange={(event) =>
                      setEditingMemoryContent(event.target.value)
                    }
                    rows={2}
                  />
                </label>
              ) : (
                <p>{entry.content}</p>
              )}
              <button
                type="button"
                onClick={() => {
                  if (editingMemoryId === entry.id) {
                    void handleSaveMemory();
                  } else {
                    setEditingMemoryId(entry.id);
                    setEditingMemoryContent(entry.content);
                  }
                }}
              >
                {editingMemoryId === entry.id ? "保存" : "编辑"}
              </button>
              {!entry.confirmed_by_user ? (
                <button
                  type="button"
                  onClick={() => void handleConfirmMemory(entry)}
                >
                  确认
                </button>
              ) : null}
              {!entry.confirmed_by_user ? (
                <button
                  type="button"
                  onClick={() => void handleRejectMemory(entry)}
                >
                  拒绝
                </button>
              ) : null}
              <button type="button" onClick={() => void handleTogglePin(entry)}>
                {entry.pinned ? "取消固定" : "固定"}
              </button>
              <button
                type="button"
                onClick={() => void handleToggleDisabled(entry)}
              >
                {entry.disabled ? "恢复" : "暂时禁用"}
              </button>
              <button
                type="button"
                onClick={() => void handleIgnoreType(entry)}
              >
                不再记住此类
              </button>
              <button
                type="button"
                onClick={() => void handlePermanentDelete(entry)}
              >
                {confirmingMemoryId === entry.id ? "确认彻底删除？" : "彻底删除"}
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteMemory(entry)}
              >
                {confirmingMemoryId === entry.id ? "确认删除？" : "删除"}
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" onClick={() => void handleClearMemory()}>
        {confirmingMemoryClear ? "确认清空记忆？" : "清空记忆"}
      </button>
      {ignoreRules.length > 0 ? (
        <div>
          <p>不再记住的信息类型</p>
          <ul>
            {ignoreRules.map((rule) => (
              <li key={rule.id}>
                <span>{memoryTypeLabel(rule.type)}</span>
                <button
                  type="button"
                  onClick={() => void handleUnignore(rule)}
                >
                  恢复记住
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {privacyStatement ? (
        <details>
          <summary>隐私说明</summary>
          <p>{privacyStatement}</p>
        </details>
      ) : null}
    </SettingsPanel>
  );
}