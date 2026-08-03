import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearMemoryEntries,
  deleteMemoryEntry,
  getMemorySettings,
  listMemoryEntries,
  memoryTypeLabel,
  updateMemoryEntry,
  updateMemorySettings,
} from "./memoryClient";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

beforeEach(() => {
  vi.mocked(invoke).mockResolvedValue({
    baseUrl: "http://127.0.0.1:43123",
    bearerToken: "startup-token",
  });
});

function fixtureEntry(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "memory-1",
    type: "user_fact",
    content: "用户偏好简洁回答",
    source_message_id: null,
    confidence: 0.9,
    created_at: "2026-08-04T00:00:00Z",
    updated_at: "2026-08-04T00:00:00Z",
    last_used_at: null,
    confirmed_by_user: true,
    sensitive: false,
    expires_at: null,
    conflict_group: null,
    ...overrides,
  };
}

describe("memoryClient", () => {
  it("lists memory entries with an optional type filter", async () => {
    const entry = fixtureEntry();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ entries: [entry], total: 1 }), {
          status: 200,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await listMemoryEntries("preference");
    expect(result.total).toBe(1);
    expect(result.entries[0].content).toBe("用户偏好简洁回答");
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("/v1/memory/entries");
    expect(url).toContain("type=preference");
  });

  it("updates a memory entry via PATCH", async () => {
    const entry = fixtureEntry({ content: "已更新内容" });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(entry), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await updateMemoryEntry(entry.id as string, {
      content: "已更新内容",
      confirmed: true,
    });
    expect(result.content).toBe("已更新内容");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(`/v1/memory/entries/${entry.id}`);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({
      content: "已更新内容",
      confirmed: true,
    });
  });

  it("deletes a single memory entry", async () => {
    const entry = fixtureEntry();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(entry), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await deleteMemoryEntry(entry.id as string);
    expect(result.id).toBe(entry.id);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(`/v1/memory/entries/${entry.id}`);
    expect(init.method).toBe("DELETE");
  });

  it("clears all memory entries", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ cleared: true }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await clearMemoryEntries();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/v1/memory/entries");
    expect(init.method).toBe("DELETE");
  });

  it("reads and updates memory settings", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ enabled: true }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ enabled: false }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const settings = await getMemorySettings();
    expect(settings.enabled).toBe(true);

    const updated = await updateMemorySettings(false);
    expect(updated.enabled).toBe(false);
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toContain("/v1/memory/settings");
    expect(init.method).toBe("PUT");
  });

  it("maps memory type labels", () => {
    expect(memoryTypeLabel("preference")).toBe("偏好");
    expect(memoryTypeLabel("unknown_type")).toBe("unknown_type");
  });
});