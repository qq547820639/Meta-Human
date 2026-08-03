import { invoke } from "@tauri-apps/api/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchDefaultHuman,
  fetchRecentConversation,
  fetchResumableBuildJob,
  isHumanReady,
} from "./restoreClient";

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

describe("restoreClient", () => {
  it("fetches the default digital human", async () => {
    vi.mocked(invoke).mockResolvedValue(connection);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "human-1",
          name: "我的数字人",
          creation_status: "ready",
          portrait_path: "/tmp/portrait.jpg",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const human = await fetchDefaultHuman();

    expect(human).toEqual({
      id: "human-1",
      name: "我的数字人",
      status: "ready",
      portraitPath: "/tmp/portrait.jpg",
      createdAt: null,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:43123/v1/avatar/humans/default",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer startup-token",
        }),
      }),
    );
  });

  it("returns null when the default human endpoint is unreachable", async () => {
    vi.mocked(invoke).mockResolvedValue(connection);
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 503 })),
    );

    expect(await fetchDefaultHuman()).toBeNull();
  });

  it("fetches the most recent conversation from an items envelope", async () => {
    vi.mocked(invoke).mockResolvedValue(connection);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            {
              id: "conv-1",
              title: "昨天的对话",
              updated_at: "2026-08-01T09:00:00Z",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const conversation = await fetchRecentConversation();

    expect(conversation).toEqual({
      id: "conv-1",
      name: "昨天的对话",
      updatedAt: "2026-08-01T09:00:00Z",
      archived: undefined,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:43123/v1/conversations?limit=1",
      expect.anything(),
    );
  });

  it("returns null when there is no recent conversation", async () => {
    vi.mocked(invoke).mockResolvedValue(connection);
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ items: [] }), { status: 200 }),
      ),
    );

    expect(await fetchRecentConversation()).toBeNull();
  });

  it("fetches an unfinished build job", async () => {
    vi.mocked(invoke).mockResolvedValue(connection);
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            id: "job-1",
            status: "running",
            current_stage: "enroll_voice",
          }),
          { status: 200 },
        ),
      ),
    );

    const job = await fetchResumableBuildJob();

    expect(job).toEqual({
      id: "job-1",
      status: "running",
      stage: "enroll_voice",
    });
  });

  it("returns null when there is no build job", async () => {
    vi.mocked(invoke).mockResolvedValue(connection);
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 200 })),
    );

    expect(await fetchResumableBuildJob()).toBeNull();
  });

  it("treats a ready human as restorable", () => {
    expect(isHumanReady({ id: "h", name: "n", status: "ready" })).toBe(true);
    expect(isHumanReady({ id: "h", name: "n", status: "building" })).toBe(false);
    expect(isHumanReady(null)).toBe(false);
  });
});