import { invoke } from "@tauri-apps/api/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  deleteKnowledgeSource,
  listKnowledgeSources,
  listKnowledgeSourcesPage,
  resyncKnowledgeSource,
  setKnowledgeSourceEnabled,
} from "./knowledgeClient";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubConnection() {
  vi.mocked(invoke).mockResolvedValue({
    baseUrl: "http://127.0.0.1:43123",
    bearerToken: "startup-token",
  });
}

describe("knowledgeClient", () => {
  it("lists knowledge sources through the sidecar", async () => {
    stubConnection();
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
                enabled: true,
                status: "ready",
                freshness: "fresh",
                sync_progress: 100,
                sync_stage: "done",
                last_error: null,
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
        enabled: true,
        status: "ready",
        freshness: "fresh",
        syncProgress: 100,
        syncStage: "done",
        lastError: null,
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
    stubConnection();
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
    stubConnection();
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
        enabled: true,
        status: "ready",
        freshness: "never",
        syncProgress: 0,
        syncStage: null,
        lastError: null,
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

  it("enables a knowledge source through PATCH", async () => {
    stubConnection();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          document_id: "doc-1",
          title: "Guide",
          chunk_count: 2,
          enabled: false,
          status: "paused",
          freshness: "fresh",
          sync_progress: 100,
          sync_stage: null,
          last_error: null,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const source = await setKnowledgeSourceEnabled("doc-1", false);

    expect(source.enabled).toBe(false);
    expect(source.status).toBe("paused");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:43123/v1/knowledge/sources/doc-1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ enabled: false }),
      }),
    );
  });

  it("resyncs a knowledge source through POST", async () => {
    stubConnection();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          document_id: "doc-1",
          status: "syncing",
          enabled: true,
          sync_progress: 0,
          sync_stage: "starting",
          last_error: null,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await resyncKnowledgeSource("doc-1");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:43123/v1/knowledge/sources/doc-1/resync",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
