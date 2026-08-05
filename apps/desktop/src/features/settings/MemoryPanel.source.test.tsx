import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import MemoryPanel from "./MemoryPanel";
import { listMemoryEntries } from "../memory/memoryClient";
import { getSourceMessage } from "../conversation/conversationClient";

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

vi.mock("../conversation/conversationClient", () => ({
  getSourceMessage: vi.fn(),
}));

const panelProps = { setStatus: vi.fn(), setError: vi.fn() };

function entry(id: string, content: string, sourceMessageId: string | null) {
  return {
    id,
    type: "fact",
    content,
    source_message_id: sourceMessageId,
    confidence: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    last_used_at: null,
    confirmed_by_user: true,
    sensitive: false,
    expires_at: null,
    conflict_group: null,
    source: "system",
    scope: "global",
    scope_id: null,
    pinned: false,
    disabled: false,
  };
}

beforeEach(() => {
  vi.mocked(listMemoryEntries).mockResolvedValue({
    entries: [
      entry("memory-1", "用户喜欢在早上喝咖啡", "42"),
      entry("memory-2", "无来源摘要", null),
    ],
    total: 2,
  });
  vi.mocked(getSourceMessage).mockResolvedValue({
    found: true,
    role: "user",
    content: "我喜欢在早上喝咖啡",
    createdAt: "2026-01-01T00:00:00Z",
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("MemoryPanel view-source", () => {
  it("fetches and displays the source message when present", async () => {
    render(<MemoryPanel {...panelProps} />);
    await waitFor(() => expect(screen.getByText("用户喜欢在早上喝咖啡")).toBeInTheDocument());

    const viewSourceButtons = screen.getAllByRole("button", { name: "查看来源" });
    fireEvent.click(viewSourceButtons[0]);

    await waitFor(() => expect(getSourceMessage).toHaveBeenCalledWith(42));
    await waitFor(() =>
      expect(screen.getByText("我喜欢在早上喝咖啡")).toBeInTheDocument(),
    );
    expect(screen.getByText(/来源消息/)).toBeInTheDocument();
  });

  it("disables 查看来源 for memories without a source message", async () => {
    render(<MemoryPanel {...panelProps} />);
    await waitFor(() => expect(screen.getByText("用户喜欢在早上喝咖啡")).toBeInTheDocument());

    const viewSourceButtons = screen.getAllByRole("button", { name: "查看来源" });
    expect(viewSourceButtons[1]).toBeDisabled();

    fireEvent.click(viewSourceButtons[0]);
    // The entry with a source id is enabled and fetches the source.
    await waitFor(() => expect(getSourceMessage).toHaveBeenCalledTimes(1));
  });
});