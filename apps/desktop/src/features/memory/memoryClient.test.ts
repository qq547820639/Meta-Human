import { invoke } from "@tauri-apps/api/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearConversationMemory,
  getConversationMemory,
  updateConversationMemory,
} from "./memoryClient";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("memoryClient", () => {
  it("reads, updates, and clears conversation memory", async () => {
    vi.mocked(invoke).mockResolvedValue({
      baseUrl: "http://127.0.0.1:43123",
      bearerToken: "startup-token",
    });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(JSON.stringify({ summary: "旧摘要" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getConversationMemory()).resolves.toEqual({
      summary: "旧摘要",
      createdAt: null,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:43123/v1/conversation/memory",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer startup-token",
        }),
      }),
    );

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ cleared: true }), { status: 200 }),
    );
    await clearConversationMemory();
    expect(fetchMock).toHaveBeenLastCalledWith(
      "http://127.0.0.1:43123/v1/conversation/memory",
      expect.objectContaining({ method: "DELETE" }),
    );

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ summary: "新摘要" }), { status: 200 }),
    );
    await updateConversationMemory("新摘要");
    expect(fetchMock).toHaveBeenLastCalledWith(
      "http://127.0.0.1:43123/v1/conversation/memory",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ summary: "新摘要" }),
      }),
    );
  });
});
