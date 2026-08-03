import { invoke } from "@tauri-apps/api/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  Citation,
  stopGenerating,
  streamConversationReply,
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
  vi.clearAllMocks();
});

function streamResponse(lines: string[]): Response {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(lines.join("\n")));
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("streamConversationReply", () => {
  it("fires onGenerationStarted with the generation_id on the first SSE event", async () => {
    vi.mocked(invoke).mockResolvedValue(connection);
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        streamResponse([
          'data: {"type":"generation_started","generation_id":"gen-abc"}',
          'data: {"type":"stage","stage":"understanding"}',
          'data: {"type":"done","text":"完成"}',
        ]),
      ),
    );

    let generationId: string | null = null;
    await streamConversationReply({
      query: "q",
      events: {
        onGenerationStarted: (id) => {
          generationId = id;
        },
      },
    });

    expect(generationId).toBe("gen-abc");
  });

  it("dispatches phased events as it parses the NDJSON stream", async () => {
    vi.mocked(invoke).mockResolvedValue(connection);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      streamResponse([
        'data: {"type":"stage","stage":"understanding"}',
        'data: {"type":"stage","stage":"retrieving"}',
        'data: {"type":"stage","stage":"found_sources","count":3}',
        'data: {"type":"token","text":"你好"}',
        'data: {"type":"token","text":"世界。"}',
        'data: {"type":"citations","citations":[{"id":"src-1","title":"指南","type":"doc","snippet":"片段","url":"https://feishu.cn/docx/doc-1"}],"grounded":true}',
        'data: {"type":"done","text":"你好世界。"}',
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const stages: string[] = [];
    const tokens: string[] = [];
    let sources = 0;
    let citations: Citation[] = [];
    let grounded = false;
    let done = "";
    await streamConversationReply({
      query: "如何进入？",
      conversationId: "conv-1",
      regenerate: true,
      events: {
        onStage: (stage) => stages.push(stage),
        onFoundSources: (count) => {
          sources = count;
        },
        onToken: (text) => tokens.push(text),
        onCitations: (c, g) => {
          citations = c;
          grounded = g;
        },
        onDone: (text) => {
          done = text;
        },
      },
    });

    expect(stages).toEqual(["understanding", "retrieving"]);
    expect(sources).toBe(3);
    expect(tokens).toEqual(["你好", "世界。"]);
    expect(grounded).toBe(true);
    expect(citations[0]).toMatchObject({
      id: "src-1",
      title: "指南",
      type: "doc",
      url: "https://feishu.cn/docx/doc-1",
    });
    expect(done).toBe("你好世界。");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:43123/v1/conversation/replies/stream",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          query: "如何进入？",
          conversation_id: "conv-1",
          regenerate: true,
        }),
        headers: expect.objectContaining({
          Authorization: "Bearer startup-token",
        }),
      }),
    );
  });

  it("normalizes string citations and plain NDJSON lines", async () => {
    vi.mocked(invoke).mockResolvedValue(connection);
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        streamResponse([
          '{"type":"token","text":"来自"}',
          '"citations","citations"',
          '{"type":"citations","citations":["[Guide]"],"grounded":false}',
        ]),
      ),
    );

    let citations: Citation[] = [];
    let grounded = true;
    await streamConversationReply({
      query: "q",
      events: {
        onCitations: (c, g) => {
          citations = c;
          grounded = g;
        },
      },
    });

    expect(citations[0]).toEqual({
      id: "[Guide]",
      title: "[Guide]",
      type: "source",
    });
    expect(grounded).toBe(false);
  });

  it("delivers the error event when the reply fails", async () => {
    vi.mocked(invoke).mockResolvedValue(connection);
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        streamResponse([
          'data: {"type":"error","message":"服务超时。","retryable":true}',
        ]),
      ),
    );

    let message = "";
    let retryable = false;
    await streamConversationReply({
      query: "q",
      events: {
        onError: (m, r) => {
          message = m;
          retryable = r;
        },
      },
    });

    expect(message).toBe("服务超时。");
    expect(retryable).toBe(true);
  });

  it("falls back to a generic error when the stream is unavailable", async () => {
    vi.mocked(invoke).mockResolvedValue(connection);
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 })),
    );

    let message = "";
    await streamConversationReply({
      query: "q",
      events: { onError: (m) => (message = m) },
    });

    expect(message).toBe("对话服务暂时无法回复。");
  });
});

describe("stopGenerating", () => {
  it("posts a stop request carrying the generation_id", async () => {
    vi.mocked(invoke).mockResolvedValue(connection);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ stopped: true }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const stopped = await stopGenerating("gen-abc");

    expect(stopped).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:43123/v1/conversation/replies/stop",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer startup-token",
        }),
        body: JSON.stringify({ generation_id: "gen-abc" }),
      }),
    );
  });

  it("resolves false when the request body omits generation_id", async () => {
    vi.mocked(invoke).mockResolvedValue(connection);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ stopped: false }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const stopped = await stopGenerating("");

    expect(stopped).toBe(false);
    // The request body must still carry the (empty) generation_id.
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:43123/v1/conversation/replies/stop",
      expect.objectContaining({
        body: JSON.stringify({ generation_id: "" }),
      }),
    );
  });
});