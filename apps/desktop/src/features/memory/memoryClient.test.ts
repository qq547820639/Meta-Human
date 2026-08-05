import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearMemoryEntries,
  createMemoryIgnoreRule,
  deleteMemoryEntry,
  deleteMemoryIgnoreRule,
  getMemoryPrivacyStatement,
  getMemorySettings,
  listMemoryEntries,
  listMemoryIgnoreRules,
  memoryScopeLabel,
  memorySourceLabel,
  memoryTypeLabel,
  permanentDeleteMemoryEntry,
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
    source: "system",
    scope: "global",
    scope_id: null,
    pinned: false,
    disabled: false,
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

  it("maps source and scope labels", () => {
    expect(memorySourceLabel("user")).toBe("用户显式");
    expect(memorySourceLabel("system")).toBe("系统摘要");
    expect(memorySourceLabel("bogus")).toBe("bogus");
    expect(memoryScopeLabel("global")).toBe("全局");
    expect(memoryScopeLabel("digital_human")).toBe("按数字人");
    expect(memoryScopeLabel("bogus")).toBe("bogus");
  });

  it("lists entries with type, source, and scope filters", async () => {
    const entry = fixtureEntry();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ entries: [entry], total: 1 }), {
          status: 200,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await listMemoryEntries("preference", {
      source: "user",
      scope: "digital_human",
      scope_id: "dh-1",
    });
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("type=preference");
    expect(url).toContain("source=user");
    expect(url).toContain("scope=digital_human");
    expect(url).toContain("scope_id=dh-1");
  });

  it("updates pinned and disabled flags", async () => {
    const entry = fixtureEntry({ pinned: true, disabled: true });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(entry), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await updateMemoryEntry(entry.id as string, {
      pinned: true,
      disabled: true,
    });
    expect(result.pinned).toBe(true);
    expect(result.disabled).toBe(true);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      pinned: true,
      disabled: true,
    });
  });

  it("permanently deletes an entry and returns verification", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ deleted: true, verified: true }), {
          status: 200,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await permanentDeleteMemoryEntry("memory-1");
    expect(result.deleted).toBe(true);
    expect(result.verified).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/v1/memory/entries/memory-1/permanent");
    expect(init.method).toBe("DELETE");
  });

  it("lists, creates, and deletes ignore rules", async () => {
    const rule = {
      id: "rule-1",
      type: "preference",
      scope: "global",
      scope_id: null,
      created_at: "2026-08-04T00:00:00Z",
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ rules: [rule], total: 1 }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(rule), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(rule), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const listed = await listMemoryIgnoreRules();
    expect(listed.total).toBe(1);

    const created = await createMemoryIgnoreRule("preference");
    expect(created.type).toBe("preference");
    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      type: "preference",
      scope: "global",
    });

    await deleteMemoryIgnoreRule("rule-1");
    const [url] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(url).toContain("/v1/memory/ignore-rules/rule-1");
  });

  it("reads the privacy statement", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ statement: "长期记忆仅保存在本机" }), {
          status: 200,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const statement = await getMemoryPrivacyStatement();
    expect(statement).toContain("本机");
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/v1/memory/privacy");
  });
});