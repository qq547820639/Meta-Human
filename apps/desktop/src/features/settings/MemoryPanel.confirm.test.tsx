import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import MemoryPanel from "./MemoryPanel";
import {
  clearMemoryEntries,
  deleteMemoryEntry,
  listMemoryEntries,
  permanentDeleteMemoryEntry,
} from "../memory/memoryClient";

vi.mock("../memory/memoryClient", () => ({
  MEMORY_TYPES: [],
  MEMORY_SOURCES: [],
  memoryTypeLabel: (t: string) => t,
  memorySourceLabel: (s: string) => s,
  memoryScopeLabel: (s: string) => s,
  getMemoryPrivacyStatement: vi.fn(() => Promise.resolve("")),
  listMemoryIgnoreRules: vi.fn(() => Promise.resolve({ rules: [] })),
  listMemoryEntries: vi.fn(),
  updateMemoryEntry: vi.fn(),
  deleteMemoryEntry: vi.fn(),
  permanentDeleteMemoryEntry: vi.fn(),
  clearMemoryEntries: vi.fn(),
  createMemoryIgnoreRule: vi.fn(),
  deleteMemoryIgnoreRule: vi.fn(),
}));

const panelProps = { setStatus: vi.fn(), setError: vi.fn() };

function entry(id: string, content: string) {
  return {
    id,
    type: "fact",
    content,
    source_message_id: null,
    confidence: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    last_used_at: null,
    confirmed_by_user: true,
    sensitive: false,
    expires_at: null,
    conflict_group: null,
    source: "conversation",
    scope: "global",
    scope_id: null,
    pinned: false,
    disabled: false,
  };
}

beforeEach(() => {
  vi.mocked(listMemoryEntries).mockResolvedValue({
    entries: [entry("memory-1", "旧摘要")],
    total: 1,
  });
  vi.mocked(deleteMemoryEntry).mockResolvedValue(entry("memory-1", "旧摘要"));
  vi.mocked(permanentDeleteMemoryEntry).mockResolvedValue({ deleted: true, verified: true });
  vi.mocked(clearMemoryEntries).mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("MemoryPanel destructive-confirmation dialogs", () => {
  it("opens a confirmation dialog before deleting a memory entry", async () => {
    render(<MemoryPanel {...panelProps} />);
    await waitFor(() => expect(screen.getByText("旧摘要")).toBeInTheDocument());

    // No dialog until the user triggers the destructive action.
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "删除" }));

    const dialog = screen.getByRole("dialog", { name: "删除记忆" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveTextContent("确认删除");

    // The API is not called until the user confirms inside the dialog.
    expect(deleteMemoryEntry).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
    await waitFor(() =>
      expect(deleteMemoryEntry).toHaveBeenCalledWith("memory-1"),
    );
  });

  it("does not delete when the user cancels the confirmation dialog", async () => {
    render(<MemoryPanel {...panelProps} />);
    await waitFor(() => expect(screen.getByText("旧摘要")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(deleteMemoryEntry).not.toHaveBeenCalled();
  });

  it("opens a confirmation dialog before permanently deleting a memory entry", async () => {
    render(<MemoryPanel {...panelProps} />);
    await waitFor(() => expect(screen.getByText("旧摘要")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "彻底删除" }));
    expect(
      screen.getByRole("dialog", { name: "彻底删除记忆" }),
    ).toBeInTheDocument();
    expect(permanentDeleteMemoryEntry).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "确认彻底删除" }));
    await waitFor(() =>
      expect(permanentDeleteMemoryEntry).toHaveBeenCalledWith("memory-1"),
    );
  });

  it("opens a confirmation dialog before clearing all memory", async () => {
    render(<MemoryPanel {...panelProps} />);
    await waitFor(() => expect(screen.getByText("旧摘要")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "清空记忆" }));
    expect(
      screen.getByRole("dialog", { name: "清空记忆" }),
    ).toBeInTheDocument();
    expect(clearMemoryEntries).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "清空" }));
    await waitFor(() => expect(clearMemoryEntries).toHaveBeenCalledTimes(1));
  });
});
