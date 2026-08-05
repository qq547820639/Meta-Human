import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError } from "../../api/client";
import ConfirmDialog from "../../ui/ConfirmDialog";
import {
  ConversationSummary,
  archiveConversation,
  clearConversationMessages,
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  renameConversation,
  searchConversations,
  unarchiveConversation,
} from "./conversationManagementClient";
import {
  buildJsonExport,
  buildMarkdownExport,
  exportFileName,
  saveTextFile,
  type ConversationExportData,
  type ExportFormat,
} from "./conversationExport";

interface ConversationManagementProps {
  readonly selectedId?: string | null;
  readonly onSelect?: (conversation: ConversationSummary) => void;
  readonly onCreated?: (conversation: ConversationSummary) => void;
  readonly onCleared?: (conversation: ConversationSummary) => void;
  readonly onDeleted?: (id: string) => void;
}

/** Search debounce window (ms). */
const SEARCH_DEBOUNCE_MS = 250;
/** Number of conversations fetched per server page. */
const PAGE_SIZE = 20;

interface ErrorInfo {
  readonly message: string;
  readonly retryable: boolean;
  readonly requestId: string;
  readonly recommendedAction: string | null;
}

/** A failed action plus a way to re-run it. */
interface ActionError {
  readonly info: ErrorInfo;
  readonly retry: () => void;
}

type FilterTab = "active" | "archived";

function toErrorInfo(err: unknown): ErrorInfo {
  if (err instanceof ApiError) {
    return {
      message: err.recommendedAction ?? err.message,
      retryable: err.retryable,
      requestId: err.requestId,
      recommendedAction: err.recommendedAction,
    };
  }
  return {
    message: "请求失败，请稍后重试。",
    retryable: true,
    requestId: "",
    recommendedAction: null,
  };
}

/** A request aborted because a newer one superseded it is not a real error. */
function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

/** Removes duplicate ids (guards against sorting drift across pages). */
function dedupeConversations(
  list: readonly ConversationSummary[],
): ConversationSummary[] {
  const seen = new Set<string>();
  const out: ConversationSummary[] = [];
  for (const item of list) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      out.push(item);
    }
  }
  return out;
}

function ErrorNotice({
  error,
  onRetry,
}: {
  error: ErrorInfo;
  onRetry?: () => void;
}) {
  return (
    <div role="alert" className="conversation-error">
      <p>{error.message}</p>
      {error.recommendedAction && error.recommendedAction !== error.message ? (
        <p className="conversation-error-detail">{error.recommendedAction}</p>
      ) : null}
      {error.retryable ? (
        <p className="conversation-error-detail">可重试</p>
      ) : null}
      {error.requestId ? (
        <p className="conversation-error-detail">
          请求 ID：{error.requestId}
        </p>
      ) : null}
      {onRetry ? (
        <button type="button" onClick={onRetry}>
          重试
        </button>
      ) : null}
    </div>
  );
}

/**
 * A sidebar that lists conversations and lets the user create, switch, search,
 * rename, archive, clear, delete and export them through the sidecar.
 *
 * Search is debounced (250ms) and guarded by a request-sequence number so a
 * late-returning stale request can never overwrite newer results. The list is
 * rendered in pages (load-more button) instead of all at once. Active /
 * archived filtering is a client-side toggle. Delete and clear both use a real
 * confirmation dialog (not the "click again within 3s" pattern), and a failed
 * delete rolls the list back to its pre-delete state. Keyboard navigation
 * (arrows / Enter / Delete) is supported and the current conversation is
 * highlighted.
 */
export default function ConversationManagement({
  selectedId,
  onSelect,
  onCreated,
  onCleared,
  onDeleted,
}: ConversationManagementProps) {
  const [items, setItems] = useState<readonly ConversationSummary[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [filter, setFilter] = useState<FilterTab>("active");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listError, setListError] = useState<ErrorInfo | null>(null);
  const [actionError, setActionError] = useState<ActionError | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ConversationSummary | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);
  const [clearTarget, setClearTarget] = useState<ConversationSummary | null>(
    null,
  );
  const [clearing, setClearing] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  // Request sequence: only the latest search/list response may update state.
  const searchSeqRef = useRef(0);
  // Abort controller: cancels the in-flight request when a newer one starts.
  const abortRef = useRef<AbortController | null>(null);
  // Mirror of `items` so "load more" always reads the current page offset.
  const itemsRef = useRef<readonly ConversationSummary[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  // The active/archived tabs map to a server-side archive filter so each page
  // is filtered and counted on the server (avoids cross-page drift).
  const archiveFilter: "active" | "archived" =
    filter === "active" ? "active" : "archived";

  const load = useCallback(async () => {
    const seq = ++searchSeqRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setListError(null);
    try {
      const q = debouncedQuery.trim();
      const page = q
        ? await searchConversations(q, {
            limit: PAGE_SIZE,
            offset: 0,
            signal: controller.signal,
          })
        : await listConversations({
            limit: PAGE_SIZE,
            offset: 0,
            archived: archiveFilter,
            signal: controller.signal,
          });
      if (seq !== searchSeqRef.current) {
        return; // A newer request superseded this one.
      }
      itemsRef.current = page.items;
      setItems(page.items);
      setHasMore(page.hasMore);
      setTotal(page.total);
      setActiveIndex(-1);
    } catch (err) {
      if (seq !== searchSeqRef.current) {
        return;
      }
      if (isAbortError(err)) {
        return;
      }
      setListError(toErrorInfo(err));
    } finally {
      if (seq === searchSeqRef.current) {
        setLoading(false);
      }
    }
  }, [debouncedQuery, archiveFilter]);

  // Debounce the search query.
  useEffect(() => {
    const timer = window.setTimeout(
      () => setDebouncedQuery(query),
      SEARCH_DEBOUNCE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [query]);

  // Refetch whenever the (debounced) query or archive filter changes.
  useEffect(() => {
    void load();
  }, [load]);

  // "加载更多" must hit the server for the next page (offset = items fetched),
  // not slice a client-side snapshot. Guards against duplicates via `dedupe`.
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) {
      return;
    }
    setLoadingMore(true);
    setListError(null);
    try {
      const q = debouncedQuery.trim();
      const offset = itemsRef.current.length;
      const page = q
        ? await searchConversations(q, {
            limit: PAGE_SIZE,
            offset,
          })
        : await listConversations({
            limit: PAGE_SIZE,
            offset,
            archived: archiveFilter,
          });
      const merged = dedupeConversations([...itemsRef.current, ...page.items]);
      itemsRef.current = merged;
      setItems(merged);
      setHasMore(page.hasMore);
      setTotal(page.total);
    } catch (err) {
      if (isAbortError(err)) {
        return;
      }
      setListError(toErrorInfo(err));
    } finally {
      setLoadingMore(false);
    }
  }, [debouncedQuery, archiveFilter, hasMore, loadingMore]);

  // Keep the keyboard-highlighted item in view.
  useEffect(() => {
    if (activeIndex < 0) {
      return;
    }
    const node = listRef.current?.querySelector<HTMLElement>(
      `[data-index="${activeIndex}"]`,
    );
    if (node && typeof node.scrollIntoView === "function") {
      node.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex]);

  const searching = debouncedQuery.trim() !== "";

  function handleFilterChange(next: FilterTab) {
    setFilter(next);
    setActiveIndex(-1);
  }

  function handleCreate() {
    void (async () => {
      try {
        const conversation = await createConversation();
        await load();
        onCreated?.(conversation);
        setActionError(null);
        inputRef.current?.focus();
      } catch (err) {
        setActionError({ info: toErrorInfo(err), retry: () => void handleCreate() });
      }
    })();
  }

  function startRename(conversation: ConversationSummary) {
    setRenamingId(conversation.id);
    setRenameValue(conversation.name);
  }

  function saveRename(conversation: ConversationSummary) {
    const name = renameValue.trim();
    if (!name) {
      setRenamingId(null);
      return;
    }
    void (async () => {
      try {
        await renameConversation(conversation.id, name);
        setRenamingId(null);
        await load();
        setActionError(null);
      } catch (err) {
        setActionError({ info: toErrorInfo(err), retry: () => void saveRename(conversation) });
      }
    })();
  }

  function handleArchive(conversation: ConversationSummary) {
    void (async () => {
      try {
        if (conversation.archived) {
          await unarchiveConversation(conversation.id);
        } else {
          await archiveConversation(conversation.id);
        }
        await load();
        setActionError(null);
      } catch (err) {
        setActionError({ info: toErrorInfo(err), retry: () => void handleArchive(conversation) });
      }
    })();
  }

  async function confirmDelete() {
    const target = deleteTarget;
    if (!target) {
      return;
    }
    setDeleting(true);
    const snapshot = items;
    // Optimistic removal; rolled back if the request fails.
    setItems((current) => current.filter((c) => c.id !== target.id));
    itemsRef.current = items.filter((c) => c.id !== target.id);
    try {
      await deleteConversation(target.id);
      setDeleteTarget(null);
      onDeleted?.(target.id);
      setActionError(null);
    } catch (err) {
      setItems(snapshot); // rollback on failure
      itemsRef.current = snapshot;
      setDeleteTarget(null);
      setActionError({ info: toErrorInfo(err), retry: () => void confirmDelete() });
    } finally {
      setDeleting(false);
    }
  }

  async function confirmClear() {
    const target = clearTarget;
    if (!target) {
      return;
    }
    setClearing(true);
    try {
      await clearConversationMessages(target.id);
      setClearTarget(null);
      onCleared?.(target);
      setActionError(null);
    } catch (err) {
      setClearTarget(null);
      setActionError({ info: toErrorInfo(err), retry: () => void confirmClear() });
    } finally {
      setClearing(false);
    }
  }

  async function handleExport(format: ExportFormat) {
    if (!selectedId) {
      setActionError({
        info: {
          message: "请先选择要导出的会话。",
          retryable: false,
          requestId: "",
          recommendedAction: null,
        },
        retry: () => void handleExport(format),
      });
      return;
    }
    try {
      const detail = await getConversation(selectedId);
      const messages: ConversationExportData["messages"] = detail.messages.map(
        (message) => ({
          role: message.role,
          text: message.content,
          createdAt: message.createdAt ?? null,
          citations: message.citations ?? [],
          grounded: message.grounded,
        }),
      );
      if (messages.length === 0) {
        setActionError({
          info: {
            message: "该会话暂无内容可导出。",
            retryable: false,
            requestId: "",
            recommendedAction: null,
          },
          retry: () => void handleExport(format),
        });
        return;
      }
      const data: ConversationExportData = {
        conversationName: detail.name || "未命名对话",
        exportedAt: new Date().toISOString(),
        digitalHuman: "",
        model: "",
        appVersion: "",
        messages,
      };
      const content =
        format === "markdown"
          ? buildMarkdownExport(data)
          : buildJsonExport(data);
      const saved = await saveTextFile(
        exportFileName(data.conversationName, format),
        content,
      );
      if (saved === null) {
        // User cancelled the native save dialog; that is not an error.
        setActionError(null);
        return;
      }
      setActionError(null);
    } catch (err) {
      setActionError({
        info: toErrorInfo(err),
        retry: () => void handleExport(format),
      });
    }
  }

  function handleListKeyDown(event: React.KeyboardEvent<HTMLUListElement>) {
    if (items.length === 0) {
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => Math.min(current + 1, items.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter") {
      if (activeIndex >= 0 && activeIndex < items.length) {
        event.preventDefault();
        onSelect?.(items[activeIndex]);
      }
    } else if (event.key === "Delete") {
      if (activeIndex >= 0 && activeIndex < items.length) {
        event.preventDefault();
        setDeleteTarget(items[activeIndex]);
      }
    }
  }

  return (
    <aside className="conversation-management" aria-label="对话管理">
      <button type="button" onClick={handleCreate}>
        新建对话
      </button>
      <label>
        搜索对话
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索对话"
        />
      </label>
      <div role="tablist" aria-label="会话筛选">
        <button
          type="button"
          role="tab"
          aria-selected={filter === "active"}
          onClick={() => handleFilterChange("active")}
        >
          活跃
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={filter === "archived"}
          onClick={() => handleFilterChange("archived")}
        >
          已归档
        </button>
      </div>
      {actionError ? (
        <ErrorNotice error={actionError.info} onRetry={actionError.retry} />
      ) : null}
      {listError ? (
        <ErrorNotice error={listError} onRetry={() => void load()} />
      ) : null}
      {loading ? <p>正在加载对话…</p> : null}
      {!loading && !listError && items.length === 0 ? (
        <p>
          {searching
            ? "没有匹配的会话。"
            : filter === "active"
              ? "暂无活跃会话。"
              : "暂无已归档会话。"}
        </p>
      ) : null}
      {!loading && !listError ? (
        <ul
          ref={listRef}
          className="conversation-list"
          tabIndex={0}
          aria-label="对话列表"
          onKeyDown={handleListKeyDown}
        >
          {items.map((conversation, index) => (
            <li
              key={conversation.id}
              data-index={index}
              className={[
                "conversation-item",
                conversation.id === selectedId ? "selected" : "",
                activeIndex === index ? "keyboard-active" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              aria-current={conversation.id === selectedId ? "true" : undefined}
            >
              {renamingId === conversation.id ? (
                <input
                  aria-label="对话名称"
                  value={renameValue}
                  onChange={(event) => setRenameValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      saveRename(conversation);
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
                    ? saveRename(conversation)
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
                onClick={() => setClearTarget(conversation)}
              >
                清空
              </button>
              <button
                type="button"
                onClick={() => setDeleteTarget(conversation)}
              >
                删除
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {!loading && hasMore ? (
        <button
          type="button"
          onClick={() => void loadMore()}
          disabled={loadingMore}
        >
          {loadingMore ? "加载中…" : "加载更多"}
        </button>
      ) : null}
      <button type="button" onClick={() => void handleExport("markdown")}>
        导出当前会话（Markdown）
      </button>
      <button type="button" onClick={() => void handleExport("json")}>
        导出当前会话（JSON）
      </button>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="删除对话"
        titleId="delete-dialog-title"
        onClose={() => setDeleteTarget(null)}
      >
        <p>
          确认删除「{deleteTarget?.name}」？将永久删除该会话及其全部
          消息，此操作不可撤销。由该会话派生的长期记忆（衍生记忆）不会随
          会话一并删除，如需删除请前往「会话与记忆」面板操作。
        </p>
        <button
          type="button"
          onClick={() => setDeleteTarget(null)}
          disabled={deleting}
        >
          取消
        </button>
        <button
          type="button"
          onClick={() => void confirmDelete()}
          disabled={deleting}
        >
          {deleting ? "删除中…" : "删除"}
        </button>
      </ConfirmDialog>

      <ConfirmDialog
        open={clearTarget !== null}
        title="清空对话"
        titleId="clear-dialog-title"
        onClose={() => setClearTarget(null)}
      >
        <p>
          确认清空「{clearTarget?.name}」的全部消息？将删除该会话的全部
          消息，此操作不可撤销。
        </p>
        <button
          type="button"
          onClick={() => setClearTarget(null)}
          disabled={clearing}
        >
          取消
        </button>
        <button
          type="button"
          onClick={() => void confirmClear()}
          disabled={clearing}
        >
          {clearing ? "清空中…" : "清空"}
        </button>
      </ConfirmDialog>
    </aside>
  );
}