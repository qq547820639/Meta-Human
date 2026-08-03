import { invoke } from "@tauri-apps/api/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearConversationHistory,
  listConversationHistory,
  postConversationReply,
  transcribeRecording,
} from "./conversationClient";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const connection = {
  baseUrl: "http://127.0.0.1:43123",
  bearerToken: "startup-token",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("conversationClient", () => {
  it("posts the query with the native bearer token", async () => {
    vi.mocked(invoke).mockResolvedValue(connection);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          text: "回答",
          citations: ["[Guide]"],
          grounded: true,
          audio_base64: "QUJD",
          citation_urls: ["https://feishu.cn/docx/doc-1"],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const controller = new AbortController();
    const reply = await postConversationReply("如何进入？", controller.signal);

    expect(reply.grounded).toBe(true);
    expect(reply.audioBase64).toBe("QUJD");
    expect(reply.citationUrls).toEqual([
      "https://feishu.cn/docx/doc-1",
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:43123/v1/conversation/replies",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          query: "如何进入？",
          regenerate: false,
        }),
        headers: expect.objectContaining({
          Authorization: "Bearer startup-token",
        }),
        signal: controller.signal,
      }),
    );
  });

  it("fails closed when the sidecar rejects the reply", async () => {
    vi.mocked(invoke).mockResolvedValue(connection);
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response("{}", { status: 503 }),
      ),
    );

    await expect(postConversationReply("你好")).rejects.toThrow(
      "对话服务暂时无法回复。",
    );
  });

  it("transcribes a captured recording through the sidecar", async () => {
    vi.mocked(invoke).mockResolvedValue(connection);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ text: "语音内容" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const text = await transcribeRecording("/tmp/voice.wav");

    expect(text).toBe("语音内容");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:43123/v1/conversation/transcribe",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ audio_path: "/tmp/voice.wav" }),
        headers: expect.objectContaining({
          Authorization: "Bearer startup-token",
        }),
      }),
    );
  });

  it("loads saved conversation history through the native bearer token", async () => {
    vi.mocked(invoke).mockResolvedValue(connection);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          messages: [
            {
              role: "user",
              content: "昨天问过",
              created_at: "2026-08-01T09:00:00Z",
            },
            {
              role: "assistant",
              content: "昨天回答过",
              citations: ["[项目验收手册]"],
              citation_urls: ["https://feishu.cn/docx/doc-1"],
              grounded: true,
              created_at: "2026-08-01T09:00:01Z",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const history = await listConversationHistory();

    expect(history.messages).toHaveLength(2);
    expect(history.messages[1]).toMatchObject({
      citations: ["[项目验收手册]"],
      citationUrls: ["https://feishu.cn/docx/doc-1"],
      grounded: true,
      createdAt: "2026-08-01T09:00:01Z",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:43123/v1/conversation/history",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer startup-token",
        }),
      }),
    );
  });

  it("clears saved conversation history", async () => {
    vi.mocked(invoke).mockResolvedValue(connection);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ cleared: true }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await clearConversationHistory();

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:43123/v1/conversation/history",
      expect.objectContaining({
        method: "DELETE",
        headers: expect.objectContaining({
          Authorization: "Bearer startup-token",
        }),
      }),
    );
  });
});
