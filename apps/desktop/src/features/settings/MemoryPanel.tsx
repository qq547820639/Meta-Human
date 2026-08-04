import { useEffect, useState } from "react";

import SettingsPanel from "./SettingsPanel";
import {
  MEMORY_TYPES,
  MemoryEntry,
  clearMemoryEntries,
  deleteMemoryEntry,
  listMemoryEntries,
  memoryTypeLabel,
  updateMemoryEntry,
} from "../memory/memoryClient";

interface MemoryPanelProps {
  readonly setStatus: (value: string | null) => void;
  readonly setError: (value: string | null) => void;
}

export default function MemoryPanel({ setStatus, setError }: MemoryPanelProps) {
  const [memoryEntries, setMemoryEntries] = useState<MemoryEntry[]>([]);
  const [memoryTypeFilter, setMemoryTypeFilter] = useState<string>("");
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
    listMemoryEntries(memoryTypeFilter || undefined)
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
  }, [memoryTypeFilter]);

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
      {memoryEntries.length === 0 && !memoryLoading ? (
        <p>暂无记忆。</p>
      ) : (
        <ul>
          {memoryEntries.map((entry) => (
            <li key={entry.id}>
              <span>{memoryTypeLabel(entry.type)}</span>
              {entry.sensitive ? <span>（敏感）</span> : null}
              {entry.conflict_group ? <span>（冲突）</span> : null}
              {!entry.confirmed_by_user ? <span>（待确认）</span> : null}
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
    </SettingsPanel>
  );
}