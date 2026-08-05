import { invoke } from "@tauri-apps/api/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../api/client";
import {
  archiveConversation,
  clearConversationMessages,
  createConversation,
  deleteConversation,
  getConversation,
  listConversationMessages,
  listConversations,
  renameConversation,
  searchConversations,
  unarchiveConversation,
} from "./conversationManagementClient";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const connection = {
  baseUrl: "http://127.0.0.1:43123",
  bearerToken: "startup-token",
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("conversationManagementClient", () => {
  it("lists conversations with pagination metadata from the server", async () => {
    vi.mocked(invoke).mockResolvedValue(connection);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        conversations: [
          { id: "conv-1", title: "对话一", updated_at: "2026-08-01T00:00:00Z" },
          { id: "conv-2", title: "对话二", archived: true },
        ],
        total: 2,
        has_more: false,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const page = await listConversations({ limit: 20, offset: 0 });

    expect(page.items).toHaveLength(2);
    expect(page.items[0].updatedAt).toBe("2026-08-01T00:00:00Z");
    expect(page.items[1].archived).toBe(true);
    expect(page.hasMore).toBe(false);
    expect(page.total).toBe(2);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:43123/v1/conversations?limit=20&offset=0",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("reports has_more when another server page exists", async () => {
    vi.mocked(invoke).mockResolvedValue(connection);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        conversations: [{ id: "conv-1", title: "对话一" }],
        total: 51,
        has_more: true,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const page = await listConversations({ limit: 50, offset: 50 });

    expect(page.items).toHaveLength(1);
    expect(page.hasMore).toBe(true);
    expect(page.total).toBe(51);
  });

  it("searches conversations with a query and pagination parameters", async () => {
    vi.mocked(invoke).mockResolvedValue(connection);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        conversations: [{ id: "conv-1", title: "知识库" }],
        total: 1,
        has_more: false,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const page = await searchConversations("知识", { limit: 20, offset: 0 });

    expect(page.items).toHaveLength(1);
    expect(page.hasMore).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:43123/v1/conversations/search?q=%E7%9F%A5%E8%AF%86&limit=20&offset=0",
      expect.anything(),
    );
  });

  it("creates a new conversation", async () => {
    vi.mocked(invoke).mockResolvedValue(connection);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ id: "conv-new", title: "新对话" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const conversation = await createConversation("新对话");

    expect(conversation.id).toBe("conv-new");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:43123/v1/conversations",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ title: "新对话" }),
      }),
    );
  });

  it("loads a conversation by fetching metadata and messages separately", async () => {
    vi.mocked(invoke).mockResolvedValue(connection);
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockImplementation((input) => {
        const url = String(input);
        if (url.includes("/messages")) {
          return Promise.resolve(
            jsonResponse({
              messages: [
                { role: "user", content: "你好", created_at: "2026-08-01T00:00:00Z" },
                {
                  role: "assistant",
                  content: "回应",
                  citations: ["[Guide]"],
                  citation_urls: ["https://feishu.cn/docx/doc-1"],
                  grounded: true,
                },
              ],
              next_cursor: null,
              has_more: false,
            }),
          );
        }
        return Promise.resolve(
          jsonResponse({ id: "conv-1", title: "对话一" }),
        );
      }),
    );

    const detail = await getConversation("conv-1");

    expect(detail.id).toBe("conv-1");
    expect(detail.name).toBe("对话一");
    expect(detail.messages).toHaveLength(2);
    expect(detail.messages[1]).toMatchObject({
      role: "assistant",
      citations: ["[Guide]"],
      citationUrls: ["https://feishu.cn/docx/doc-1"],
      grounded: true,
    });
  });

  it("lists conversation messages with cursor pagination", async () => {
    vi.mocked(invoke).mockResolvedValue(connection);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        messages: [
          { role: "user", content: "你好", created_at: "2026-08-01T00:00:00Z" },
          { role: "assistant", content: "回应" },
        ],
        next_cursor: "42",
        has_more: true,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const page = await listConversationMessages("conv-1", {
      limit: 50,
      cursor: "41",
    });

    expect(page.messages).toHaveLength(2);
    expect(page.nextCursor).toBe("42");
    expect(page.hasMore).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:43123/v1/conversations/conv-1/messages?limit=50&cursor=41",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("throws a structured error when the messages contract is missing", async () => {
    vi.mocked(invoke).mockResolvedValue(connection);
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ next_cursor: null, has_more: false }),
      ),
    );

    const error = await listConversationMessages("conv-1").catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("invalid_response");
    expect((error as ApiError).message).toContain("对话消息接口返回格式异常");
    expect((error as ApiError).recommendedAction).toBe(
      "请检查服务版本后重试。",
    );
  });

  it("renames, archives, unarchives, deletes and clears a conversation", async () => {
    vi.mocked(invoke).mockResolvedValue(connection);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, { status: 204 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await renameConversation("conv-1", "新名字");
    await archiveConversation("conv-1");
    await unarchiveConversation("conv-1");
    await deleteConversation("conv-1");
    await clearConversationMessages("conv-1");

    const urls = fetchMock.mock.calls.map((call) => call[0]);
    expect(urls).toEqual([
      "http://127.0.0.1:43123/v1/conversations/conv-1",
      "http://127.0.0.1:43123/v1/conversations/conv-1/archive",
      "http://127.0.0.1:43123/v1/conversations/conv-1/archive",
      "http://127.0.0.1:43123/v1/conversations/conv-1",
      "http://127.0.0.1:43123/v1/conversations/conv-1/clear",
    ]);
    const methods = fetchMock.mock.calls.map((call) => call[1]?.method);
    expect(methods).toEqual(["PATCH", "POST", "POST", "DELETE", "POST"]);
    const bodies = fetchMock.mock.calls.map((call) => call[1]?.body);
    expect(bodies).toEqual([
      JSON.stringify({ title: "新名字" }),
      JSON.stringify({ archived: true }),
      JSON.stringify({ archived: false }),
      undefined,
      undefined,
    ]);
  });
});