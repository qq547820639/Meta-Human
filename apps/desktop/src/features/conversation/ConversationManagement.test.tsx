import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ConversationManagement from "./ConversationManagement";
import {
  archiveConversation,
  clearConversationMessages,
  createConversation,
  deleteConversation,
  listConversations,
  renameConversation,
  searchConversations,
  unarchiveConversation,
} from "./conversationManagementClient";

vi.mock("./conversationManagementClient", () => ({
  listConversations: vi.fn(),
  searchConversations: vi.fn(),
  createConversation: vi.fn(),
  renameConversation: vi.fn(),
  archiveConversation: vi.fn(),
  unarchiveConversation: vi.fn(),
  deleteConversation: vi.fn(),
  clearConversationMessages: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ConversationManagement", () => {
  it("lists conversations and notifies when one is selected", async () => {
    vi.mocked(listConversations).mockResolvedValue([
      { id: "conv-1", name: "对话一" },
      { id: "conv-2", name: "对话二" },
    ]);
    const onSelect = vi.fn();

    render(<ConversationManagement onSelect={onSelect} />);

    await waitFor(() =>
      expect(screen.getByText("对话一")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "对话二" }));
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: "conv-2" }),
    );
  });

  it("creates a new conversation and notifies the parent", async () => {
    vi.mocked(listConversations).mockResolvedValue([]);
    vi.mocked(createConversation).mockResolvedValue({
      id: "conv-new",
      name: "新对话",
    });
    const onCreated = vi.fn();

    render(<ConversationManagement onCreated={onCreated} />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "新建对话" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "新建对话" }));
    await waitFor(() =>
      expect(onCreated).toHaveBeenCalledWith(
        expect.objectContaining({ id: "conv-new" }),
      ),
    );
  });

  it("renames a conversation through the sidecar", async () => {
    vi.mocked(listConversations).mockResolvedValue([
      { id: "conv-1", name: "旧名字" },
    ]);
    vi.mocked(renameConversation).mockResolvedValue(undefined);

    render(<ConversationManagement />);

    await waitFor(() =>
      expect(screen.getByText("旧名字")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "重命名" }));
    const input = screen.getByLabelText("对话名称");
    fireEvent.change(input, { target: { value: "新名字" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(renameConversation).toHaveBeenCalledWith("conv-1", "新名字"),
    );
  });

  it("archives, unarchives, clears and deletes a conversation", async () => {
    vi.mocked(listConversations).mockResolvedValue([
      { id: "conv-1", name: "对话一", archived: true },
      { id: "conv-2", name: "对话二" },
    ]);
    vi.mocked(unarchiveConversation).mockResolvedValue(undefined);
    vi.mocked(archiveConversation).mockResolvedValue(undefined);
    vi.mocked(clearConversationMessages).mockResolvedValue(undefined);
    vi.mocked(deleteConversation).mockResolvedValue(undefined);
    const onCleared = vi.fn();
    const onDeleted = vi.fn();

    render(
      <ConversationManagement
        onCleared={onCleared}
        onDeleted={onDeleted}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText("对话一")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "取消归档" }));
    expect(unarchiveConversation).toHaveBeenCalledWith("conv-1");

    fireEvent.click(screen.getByRole("button", { name: "归档" }));
    expect(archiveConversation).toHaveBeenCalledWith("conv-2");

    fireEvent.click(screen.getAllByRole("button", { name: "清空" })[0]);
    expect(clearConversationMessages).toHaveBeenCalledWith("conv-1");
    await waitFor(() => expect(onCleared).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getAllByRole("button", { name: "删除" })[0]);
    expect(screen.getByRole("button", { name: "确认删除？" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认删除？" }));
    await waitFor(() =>
      expect(deleteConversation).toHaveBeenCalledWith("conv-1"),
    );
    await waitFor(() =>
      expect(onDeleted).toHaveBeenCalledWith("conv-1"),
    );
  });

  it("searches conversations", async () => {
    vi.mocked(listConversations).mockResolvedValue([]);
    vi.mocked(searchConversations).mockResolvedValue([
      { id: "conv-1", name: "知识库" },
    ]);

    render(<ConversationManagement />);

    const input = screen.getByLabelText("搜索对话");
    fireEvent.change(input, { target: { value: "知识" } });

    await waitFor(() =>
      expect(searchConversations).toHaveBeenCalledWith("知识"),
    );
    await waitFor(() =>
      expect(screen.getByText("知识库")).toBeInTheDocument(),
    );
  });
});