import { invoke } from "@tauri-apps/api/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  deleteKnowledgeSource,
  listKnowledgeSources,
  listKnowledgeSourcesPage,
} from "./knowledgeClient";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("knowledgeClient", () => {
  it("lists knowledge sources through the sidecar", async () => {
    vi.mocked(invoke).mockResolvedValue({
      baseUrl: "http://127.0.0.1:43123",
      bearerToken: "startup-token",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            sources: [
              {
                document_id: "doc-1",
                title: "Guide",
                source_url: "https://feishu.cn/docx/doc-1",
                synced_at: "2026-08-03T00:00:00Z",
                chunk_count: 2,
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const sources = await listKnowledgeSources();

    expect(sources).toEqual([
      {
        documentId: "doc-1",
        title: "Guide",
        sourceUrl: "https://feishu.cn/docx/doc-1",
        syncedAt: "2026-08-03T00:00:00Z",
        chunkCount: 2,
      },
    ]);
    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:43123/v1/knowledge/sources",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer startup-token",
        }),
      }),
    );
  });

  it("deletes a knowledge source through the sidecar", async () => {
    vi.mocked(invoke).mockResolvedValue({
      baseUrl: "http://127.0.0.1:43123",
      bearerToken: "startup-token",
    });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, { status: 204 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await deleteKnowledgeSource("doc-1");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:43123/v1/knowledge/sources/doc-1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("pages knowledge sources through the sidecar with limit/offset and has_more", async () => {
    vi.mocked(invoke).mockResolvedValue({
      baseUrl: "http://127.0.0.1:43123",
      bearerToken: "startup-token",
    });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          sources: [
            {
              document_id: "doc-2",
              title: "Page",
              chunk_count: 1,
            },
          ],
          total: 320,
          has_more: true,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const page = await listKnowledgeSourcesPage({ limit: 20, offset: 100 });

    expect(page.items).toEqual([
      {
        documentId: "doc-2",
        title: "Page",
        sourceUrl: null,
        syncedAt: null,
        chunkCount: 1,
      },
    ]);
    expect(page.hasMore).toBe(true);
    expect(page.total).toBe(320);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:43123/v1/knowledge/sources?limit=20&offset=100",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer startup-token",
        }),
      }),
    );
  });
});
