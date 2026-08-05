import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../api/client";
import ConversationManagement from "./ConversationManagement";
import {
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
import type { ConversationListPage } from "./conversationManagementClient";

vi.mock("./conversationManagementClient", () => ({
  listConversations: vi.fn(),
  searchConversations: vi.fn(),
  createConversation: vi.fn(),
  getConversation: vi.fn(),
  renameConversation: vi.fn(),
  archiveConversation: vi.fn(),
  unarchiveConversation: vi.fn(),
  deleteConversation: vi.fn(),
  clearConversationMessages: vi.fn(),
}));

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

const apiError = new ApiError(
  {
    code: "upstream",
    message: "服务不可用",
    retryable: true,
    request_id: "req-1",
    recommended_action: "请稍后重试",
    technical_message: null,
    details: null,
    provider: null,
    provider_status: null,
    timestamp: null,
  },
  503,
);

/** Flushes pending microtasks/mock resolutions. */
async function flush() {
  await act(async () => {});
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.useRealTimers();
});

describe("ConversationManagement", () => {
  it("lists conversations and notifies when one is selected", async () => {
    vi.mocked(listConversations).mockResolvedValue({
      items: [
        { id: "conv-1", name: "对话一" },
        { id: "conv-2", name: "对话二" },
      ],
      hasMore: false,
      total: 2,
    });
    const onSelect = vi.fn();

    render(<ConversationManagement onSelect={onSelect} />);
    await flush();

    expect(screen.getByText("对话一")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "对话二" }));
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: "conv-2" }),
    );
  });

  it("debounces search, coalesces keystrokes and cancels the stale request", async () => {
    vi.mocked(listConversations).mockResolvedValue({
      items: [],
      hasMore: false,
      total: 0,
    });
    vi.mocked(searchConversations).mockResolvedValue({
      items: [{ id: "conv-1", name: "知识库" }],
      hasMore: false,
      total: 1,
    });

    render(<ConversationManagement />);
    await flush();

    const input = screen.getByLabelText("搜索对话");
    fireEvent.change(input, { target: { value: "a" } });
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    fireEvent.change(input, { target: { value: "ab" } });
    // Before the debounce elapses, no search should fire.
    expect(searchConversations).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(searchConversations).toHaveBeenCalledTimes(1);
    expect(searchConversations).toHaveBeenCalledWith(
      "ab",
      expect.objectContaining({ limit: 20, offset: 0, signal: expect.anything() }),
    );
    await flush();
    expect(screen.getByText("知识库")).toBeInTheDocument();
  });

  it("ignores a stale, late-returning search result", async () => {
    let resolveList: ((v: ConversationListPage) => void) | null = null;
    vi.mocked(listConversations).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveList = resolve;
        }),
    );
    render(<ConversationManagement />);
    await flush();

    const input = screen.getByLabelText("搜索对话");
    let resolveSearchA: ((v: ConversationListPage) => void) | null = null;
    vi.mocked(searchConversations).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSearchA = resolve;
        }),
    );
    fireEvent.change(input, { target: { value: "a" } });
    await act(async () => {
      vi.advanceTimersByTime(250);
    });
    expect(searchConversations).toHaveBeenCalledWith(
      "a",
      expect.anything(),
    );

    let resolveSearchAb: ((v: ConversationListPage) => void) | null = null;
    vi.mocked(searchConversations).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSearchAb = resolve;
        }),
    );
    fireEvent.change(input, { target: { value: "ab" } });
    await act(async () => {
      vi.advanceTimersByTime(250);
    });
    expect(searchConversations).toHaveBeenCalledWith(
      "ab",
      expect.anything(),
    );

    // The NEWER request resolves first.
    await act(async () => {
      resolveSearchAb?.({ items: [{ id: "b", name: "结果B" }], hasMore: false, total: 1 });
    });
    expect(screen.getByText("结果B")).toBeInTheDocument();

    // The OLDER request resolves late; it must be ignored.
    await act(async () => {
      resolveSearchA?.({ items: [{ id: "a", name: "结果A" }], hasMore: false, total: 1 });
    });
    expect(screen.queryByText("结果A")).not.toBeInTheDocument();
    expect(screen.getByText("结果B")).toBeInTheDocument();
  });

  it("filters between active and archived conversations", async () => {
    vi.mocked(listConversations).mockImplementation(async (options) => {
      const archived = options?.archived ?? "active";
      if (archived === "archived") {
        return {
          items: [{ id: "b", name: "归档B", archived: true }],
          hasMore: false,
          total: 1,
        };
      }
      return {
        items: [{ id: "a", name: "活跃A" }],
        hasMore: false,
        total: 1,
      };
    });

    render(<ConversationManagement />);
    await flush();

    expect(screen.getByText("活跃A")).toBeInTheDocument();
    expect(screen.queryByText("归档B")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "已归档" }));
    await flush();
    expect(screen.getByText("归档B")).toBeInTheDocument();
    expect(screen.queryByText("活跃A")).not.toBeInTheDocument();
  });

  it("shows loading and empty states", async () => {
    let resolveList: ((v: ConversationListPage) => void) | null = null;
    vi.mocked(listConversations).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveList = resolve;
        }),
    );
    render(<ConversationManagement />);
    await flush();
    expect(screen.getByText("正在加载对话…")).toBeInTheDocument();

    await act(async () => {
      resolveList?.({ items: [], hasMore: false, total: 0 });
    });
    expect(screen.getByText("暂无活跃会话。")).toBeInTheDocument();
  });

  it("shows an error state and recovers via retry", async () => {
    vi.mocked(listConversations).mockRejectedValueOnce(apiError);
    render(<ConversationManagement />);
    await flush();

    // ApiError surfaced with retryable confirm / request id / recommended action.
    expect(screen.getByText("请稍后重试")).toBeInTheDocument();
    expect(screen.getByText("请求 ID：req-1")).toBeInTheDocument();

    // Retry recovers.
    vi.mocked(listConversations).mockResolvedValueOnce({
      items: [{ id: "a", name: "恢复" }],
      hasMore: false,
      total: 1,
    });
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await flush();
    expect(screen.getByText("恢复")).toBeInTheDocument();
  });

  it("loads more by hitting the server for the next page (offset-based)", async () => {
    const firstPage = Array.from({ length: 20 }, (_, i) => ({
      id: `c${i}`,
      name: `会话${i}`,
    }));
    const secondPage = Array.from({ length: 5 }, (_, i) => ({
      id: `c${i + 20}`,
      name: `会话${i + 20}`,
    }));
    vi.mocked(listConversations)
      .mockResolvedValueOnce({
        items: firstPage,
        hasMore: true,
        total: 25,
      })
      .mockResolvedValueOnce({
        items: secondPage,
        hasMore: false,
        total: 25,
      });

    render(<ConversationManagement />);
    await flush();

    expect(screen.getByText("会话0")).toBeInTheDocument();
    expect(screen.queryByText("会话24")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "加载更多" }));
    await flush();

    // The second request must carry the correct server offset (items fetched).
    expect(listConversations).toHaveBeenLastCalledWith(
      expect.objectContaining({ limit: 20, offset: 20 }),
    );
    expect(screen.getByText("会话24")).toBeInTheDocument();
  });

  it("renames a conversation through the sidecar", async () => {
    vi.mocked(listConversations).mockResolvedValue({
      items: [{ id: "conv-1", name: "旧名字" }],
      hasMore: false,
      total: 1,
    });
    vi.mocked(renameConversation).mockResolvedValue(undefined);

    render(<ConversationManagement />);
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "重命名" }));
    const input = screen.getByLabelText("对话名称");
    fireEvent.change(input, { target: { value: "新名字" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await flush();
    expect(renameConversation).toHaveBeenCalledWith("conv-1", "新名字");
  });

  it("archives and unarchives a conversation", async () => {
    vi.mocked(listConversations).mockResolvedValue({
      items: [
        { id: "conv-1", name: "对话一", archived: true },
        { id: "conv-2", name: "对话二" },
      ],
      hasMore: false,
      total: 2,
    });
    vi.mocked(unarchiveConversation).mockResolvedValue(undefined);
    vi.mocked(archiveConversation).mockResolvedValue(undefined);

    render(<ConversationManagement />);
    await flush();

    // Default active tab: the non-archived conversation is visible.
    fireEvent.click(screen.getByRole("button", { name: "归档" }));
    expect(archiveConversation).toHaveBeenCalledWith("conv-2");

    // Switch to the archived tab: the archived conversation is visible.
    fireEvent.click(screen.getByRole("tab", { name: "已归档" }));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "取消归档" }));
    expect(unarchiveConversation).toHaveBeenCalledWith("conv-1");
  });

  it("clears a conversation through a confirmation dialog", async () => {
    vi.mocked(listConversations).mockResolvedValue({
      items: [{ id: "conv-1", name: "对话一" }],
      hasMore: false,
      total: 1,
    });
    vi.mocked(clearConversationMessages).mockResolvedValue(undefined);
    const onCleared = vi.fn();

    render(<ConversationManagement onCleared={onCleared} />);
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "清空" }));
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByText(/确认清空「对话一」的全部消息？/),
    ).toBeInTheDocument();
    // Clearing must not happen until the user confirms.
    expect(clearConversationMessages).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "清空" }));
    await flush();
    expect(clearConversationMessages).toHaveBeenCalledWith("conv-1");
    expect(onCleared).toHaveBeenCalledTimes(1);
  });

  it("deletes a conversation through a confirmation dialog", async () => {
    vi.mocked(listConversations).mockResolvedValue({
      items: [{ id: "conv-1", name: "对话一" }],
      hasMore: false,
      total: 1,
    });
    vi.mocked(deleteConversation).mockResolvedValue(undefined);
    const onDeleted = vi.fn();

    render(<ConversationManagement onDeleted={onDeleted} />);
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    const dialog = screen.getByRole("dialog");
    expect(deleteConversation).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "删除" }));
    await flush();
    expect(deleteConversation).toHaveBeenCalledWith("conv-1");
    expect(onDeleted).toHaveBeenCalledWith("conv-1");
    expect(screen.queryByText("对话一")).not.toBeInTheDocument();
  });

  it("closes the delete dialog on Escape and restores focus to the trigger", async () => {
    vi.mocked(listConversations).mockResolvedValue({
      items: [{ id: "conv-1", name: "对话一" }],
      hasMore: false,
      total: 1,
    });

    render(<ConversationManagement />);
    await flush();

    const deleteButton = screen.getByRole("button", { name: "删除" });
    deleteButton.focus();
    fireEvent.click(deleteButton);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-labelledby", "delete-dialog-title");

    fireEvent.keyDown(dialog, { key: "Escape" });
    await flush();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(deleteButton).toHaveFocus();
  });

  it("rolls the list back when a delete fails", async () => {
    vi.mocked(listConversations).mockResolvedValue({
      items: [{ id: "conv-1", name: "对话一" }],
      hasMore: false,
      total: 1,
    });
    vi.mocked(deleteConversation).mockRejectedValueOnce(apiError);
    const onDeleted = vi.fn();

    render(<ConversationManagement onDeleted={onDeleted} />);
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "删除" }));
    await flush();

    // The item is restored to the list after a failed delete.
    expect(screen.getByText("对话一")).toBeInTheDocument();
    expect(onDeleted).not.toHaveBeenCalled();
    expect(screen.getByText("请稍后重试")).toBeInTheDocument();
  });

  it("highlights the current conversation", async () => {
    vi.mocked(listConversations).mockResolvedValue({
      items: [
        { id: "conv-1", name: "对话一" },
        { id: "conv-2", name: "对话二" },
      ],
      hasMore: false,
      total: 2,
    });

    render(<ConversationManagement selectedId="conv-1" />);
    await flush();

    const selected = screen.getByText("对话一").closest("li");
    expect(selected).toHaveClass("selected");
    expect(selected).toHaveAttribute("aria-current", "true");

    const other = screen.getByText("对话二").closest("li");
    expect(other).not.toHaveClass("selected");
  });

  it("supports keyboard navigation (arrows, Enter, Delete)", async () => {
    vi.mocked(listConversations).mockResolvedValue({
      items: [
        { id: "a", name: "A" },
        { id: "b", name: "B" },
      ],
      hasMore: false,
      total: 2,
    });
    const onSelect = vi.fn();

    render(<ConversationManagement onSelect={onSelect} />);
    await flush();

    const list = screen.getByRole("list", { name: "对话列表" });
    fireEvent.keyDown(list, { key: "ArrowDown" });
    fireEvent.keyDown(list, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));

    fireEvent.keyDown(list, { key: "ArrowDown" });
    fireEvent.keyDown(list, { key: "ArrowDown" });
    fireEvent.keyDown(list, { key: "Delete" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("focuses the search input after creating a conversation", async () => {
    vi.mocked(listConversations).mockResolvedValue({
      items: [],
      hasMore: false,
      total: 0,
    });
    vi.mocked(createConversation).mockResolvedValue({
      id: "conv-new",
      name: "新对话",
    });
    const onCreated = vi.fn();

    render(<ConversationManagement onCreated={onCreated} />);
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "新建对话" }));
    await flush();
    expect(onCreated).toHaveBeenCalledWith(
      expect.objectContaining({ id: "conv-new" }),
    );
    expect(screen.getByLabelText("搜索对话")).toHaveFocus();
  });

  it("exports the current conversation as Markdown via the native save dialog", async () => {
    vi.mocked(listConversations).mockResolvedValue({
      items: [],
      hasMore: false,
      total: 0,
    });
    vi.mocked(getConversation).mockResolvedValue({
      id: "conv-1",
      name: "对话一",
      messages: [
        { role: "user", content: "你好" },
        { role: "assistant", content: "嗨", citations: ["来源一"] },
      ],
    });
    invokeMock.mockResolvedValue("/tmp/对话一.md");

    render(<ConversationManagement selectedId="conv-1" />);
    await flush();

    fireEvent.click(
      screen.getByRole("button", { name: "导出当前会话（Markdown）" }),
    );
    await flush();
    expect(getConversation).toHaveBeenCalledWith("conv-1");
    expect(invokeMock).toHaveBeenCalledWith(
      "save_text_file",
      expect.objectContaining({ defaultName: "对话一.md" }),
    );
    const content = invokeMock.mock.calls.at(-1)?.[1]?.content as string;
    expect(content).toContain("# 对话一");
    expect(content).toContain("你好");
    expect(content).toContain("来源：");
  });

  it("exports the current conversation as JSON via the native save dialog", async () => {
    vi.mocked(listConversations).mockResolvedValue({
      items: [],
      hasMore: false,
      total: 0,
    });
    vi.mocked(getConversation).mockResolvedValue({
      id: "conv-1",
      name: "对话一",
      messages: [
        { role: "user", content: "你好" },
        { role: "assistant", content: "嗨", citations: ["来源一"] },
      ],
    });
    invokeMock.mockResolvedValue("/tmp/对话一.json");

    render(<ConversationManagement selectedId="conv-1" />);
    await flush();

    fireEvent.click(
      screen.getByRole("button", { name: "导出当前会话（JSON）" }),
    );
    await flush();
    expect(invokeMock).toHaveBeenCalledWith(
      "save_text_file",
      expect.objectContaining({ defaultName: "对话一.json" }),
    );
    const content = invokeMock.mock.calls.at(-1)?.[1]?.content as string;
    const parsed = JSON.parse(content);
    expect(parsed.conversation.name).toBe("对话一");
    expect(parsed.messages[0].text).toBe("你好");
    expect(parsed.messages[1].citations).toEqual(["来源一"]);
  });
});