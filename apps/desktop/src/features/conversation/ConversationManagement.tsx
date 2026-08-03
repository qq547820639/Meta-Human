import { useEffect, useState } from "react";

import {
  ConversationSummary,
  archiveConversation,
  clearConversationMessages,
  createConversation,
  deleteConversation,
  listConversations,
  renameConversation,
  searchConversations,
  unarchiveConversation,
} from "./conversationManagementClient";

interface ConversationManagementProps {
  readonly selectedId?: string | null;
  readonly onSelect?: (conversation: ConversationSummary) => void;
  readonly onCreated?: (conversation: ConversationSummary) => void;
  readonly onCleared?: (conversation: ConversationSummary) => void;
  readonly onDeleted?: (id: string) => void;
}

/**
 * A sidebar that lists conversations and lets the user create, switch, search,
 * rename, archive, clear and delete them through the sidecar.
 */
export default function ConversationManagement({
  selectedId,
  onSelect,
  onCreated,
  onCleared,
  onDeleted,
}: ConversationManagementProps) {
  const [conversations, setConversations] = useState<
    readonly ConversationSummary[]
  >([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(
    null,
  );

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refresh() {
    try {
      setConversations(await listConversations());
    } catch {
      setError("无法读取对话列表。");
    }
  }

  async function handleSearch(text: string) {
    setQuery(text);
    if (!text.trim()) {
      await refresh();
      return;
    }
    try {
      setConversations(await searchConversations(text.trim()));
    } catch {
      setError("无法搜索对话。");
    }
  }

  async function handleCreate() {
    try {
      const conversation = await createConversation();
      await refresh();
      onCreated?.(conversation);
    } catch {
      setError("无法新建对话。");
    }
  }

  function startRename(conversation: ConversationSummary) {
    setRenamingId(conversation.id);
    setRenameValue(conversation.name);
  }

  async function saveRename(conversation: ConversationSummary) {
    const name = renameValue.trim();
    if (!name) {
      setRenamingId(null);
      return;
    }
    try {
      await renameConversation(conversation.id, name);
      setRenamingId(null);
      await refresh();
    } catch {
      setError("无法重命名对话。");
    }
  }

  async function handleArchive(conversation: ConversationSummary) {
    try {
      if (conversation.archived) {
        await unarchiveConversation(conversation.id);
      } else {
        await archiveConversation(conversation.id);
      }
      await refresh();
    } catch {
      setError("无法更新对话状态。");
    }
  }

  async function handleClear(conversation: ConversationSummary) {
    try {
      await clearConversationMessages(conversation.id);
      onCleared?.(conversation);
    } catch {
      setError("无法清空对话。");
    }
  }

  async function handleDelete(conversation: ConversationSummary) {
    if (confirmingDeleteId !== conversation.id) {
      setConfirmingDeleteId(conversation.id);
      window.setTimeout(() => {
        setConfirmingDeleteId((current) =>
          current === conversation.id ? null : current,
        );
      }, 3000);
      return;
    }
    try {
      await deleteConversation(conversation.id);
      setConfirmingDeleteId(null);
      onDeleted?.(conversation.id);
      await refresh();
    } catch {
      setError("无法删除对话。");
    }
  }

  return (
    <aside className="conversation-management" aria-label="对话管理">
      <button type="button" onClick={() => void handleCreate()}>
        新建对话
      </button>
      <label>
        搜索对话
        <input
          value={query}
          onChange={(event) => void handleSearch(event.target.value)}
          placeholder="搜索对话"
        />
      </label>
      {error ? <p role="alert">{error}</p> : null}
      <ul className="conversation-list">
        {conversations.map((conversation) => (
          <li
            key={conversation.id}
            className={
              conversation.id === selectedId
                ? "conversation-item selected"
                : "conversation-item"
            }
          >
            {renamingId === conversation.id ? (
              <input
                aria-label="对话名称"
                value={renameValue}
                onChange={(event) => setRenameValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    void saveRename(conversation);
                  } else if (event.key === "Escape") {
                    setRenamingId(null);
                  }
                }}
              />
            ) : (
              <button
                type="button"
                onClick={() => onSelect?.(conversation)}
              >
                {conversation.name}
              </button>
            )}
            {conversation.archived ? (
              <span aria-label="已归档">已归档</span>
            ) : null}
            <button
              type="button"
              onClick={() =>
                renamingId === conversation.id
                  ? void saveRename(conversation)
                  : startRename(conversation)
              }
            >
              {renamingId === conversation.id ? "保存名字" : "重命名"}
            </button>
            <button
              type="button"
              onClick={() => void handleArchive(conversation)}
            >
              {conversation.archived ? "取消归档" : "归档"}
            </button>
            <button
              type="button"
              onClick={() => void handleClear(conversation)}
            >
              清空
            </button>
            <button
              type="button"
              onClick={() => void handleDelete(conversation)}
            >
              {confirmingDeleteId === conversation.id ? "确认删除？" : "删除"}
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}