import { invoke } from "@tauri-apps/api/core";
import { afterEach, describe, expect, it, vi } from "vitest";

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
  it("lists conversations from an items envelope", async () => {
    vi.mocked(invoke).mockResolvedValue(connection);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        items: [
          { id: "conv-1", name: "对话一", updated_at: "2026-08-01T00:00:00Z" },
          { id: "conv-2", name: "对话二", archived: true },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const conversations = await listConversations();

    expect(conversations).toHaveLength(2);
    expect(conversations[0].updatedAt).toBe("2026-08-01T00:00:00Z");
    expect(conversations[1].archived).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:43123/v1/conversations",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("searches conversations with a query parameter", async () => {
    vi.mocked(invoke).mockResolvedValue(connection);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse([{ id: "conv-1", name: "知识库" }]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const conversations = await searchConversations("知识");

    expect(conversations).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:43123/v1/conversations/search?q=%E7%9F%A5%E8%AF%86",
      expect.anything(),
    );
  });

  it("creates a new conversation", async () => {
    vi.mocked(invoke).mockResolvedValue(connection);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ id: "conv-new", name: "新对话" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const conversation = await createConversation("新对话");

    expect(conversation.id).toBe("conv-new");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:43123/v1/conversations",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "新对话" }),
      }),
    );
  });

  it("loads a conversation with its messages", async () => {
    vi.mocked(invoke).mockResolvedValue(connection);
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({
          id: "conv-1",
          name: "对话一",
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
        }),
      ),
    );

    const detail = await getConversation("conv-1");

    expect(detail.messages).toHaveLength(2);
    expect(detail.messages[1]).toMatchObject({
      role: "assistant",
      citations: ["[Guide]"],
      citationUrls: ["https://feishu.cn/docx/doc-1"],
      grounded: true,
    });
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