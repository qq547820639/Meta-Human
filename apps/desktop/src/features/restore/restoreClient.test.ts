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
  it("fetches the default digital human and reads creation_status", async () => {
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

    const result = await fetchDefaultHuman();

    expect(result).toEqual({
      ok: true,
      data: {
        id: "human-1",
        name: "我的数字人",
        status: "ready",
        portraitPath: "/tmp/portrait.jpg",
        createdAt: null,
      },
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

  it("returns ok with no data when the default human endpoint returns 404", async () => {
    vi.mocked(invoke).mockResolvedValue(connection);
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 404 })),
    );

    expect(await fetchDefaultHuman()).toEqual({ ok: true, data: null });
  });

  it("reports a network failure as sidecar_unreachable, not ok", async () => {
    vi.mocked(invoke).mockResolvedValue(connection);
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockRejectedValue(new TypeError("Failed to fetch")),
    );

    expect(await fetchDefaultHuman()).toEqual({
      ok: false,
      error: "sidecar_unreachable",
    });
  });

  it("reports an auth failure as auth_failed", async () => {
    vi.mocked(invoke).mockResolvedValue(connection);
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({ code: "unauthorized", message: "no" }),
          { status: 401 },
        ),
      ),
    );

    expect(await fetchDefaultHuman()).toEqual({
      ok: false,
      error: "auth_failed",
    });
  });

  it("reports a server error as database_error", async () => {
    vi.mocked(invoke).mockResolvedValue(connection);
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({ code: "db_error", message: "boom" }),
          { status: 500 },
        ),
      ),
    );

    expect(await fetchDefaultHuman()).toEqual({
      ok: false,
      error: "database_error",
    });
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

    const result = await fetchRecentConversation();

    expect(result).toEqual({
      ok: true,
      data: {
        id: "conv-1",
        name: "昨天的对话",
        updatedAt: "2026-08-01T09:00:00Z",
        archived: undefined,
      },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:43123/v1/conversations?limit=1",
      expect.anything(),
    );
  });

  it("returns ok with no data when there is no recent conversation", async () => {
    vi.mocked(invoke).mockResolvedValue(connection);
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ items: [] }), { status: 200 }),
      ),
    );

    expect(await fetchRecentConversation()).toEqual({ ok: true, data: null });
  });

  it("fetches an unfinished build job and reads current_stage", async () => {
    vi.mocked(invoke).mockResolvedValue(connection);
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            id: "job-1",
            status: "running",
            current_stage: "enroll_voice",
            succeeded_stages: ["validate_inputs"],
            updated_at: "2026-08-01T10:00:00Z",
            error_code: null,
            error_detail: null,
            cancelled: false,
          }),
          { status: 200 },
        ),
      ),
    );

    const result = await fetchResumableBuildJob();

    expect(result).toEqual({
      ok: true,
      data: {
        id: "job-1",
        status: "running",
        stage: "enroll_voice",
        stageProgress: null,
        succeededStages: ["validate_inputs"],
        retryCount: 0,
        errorCode: null,
        errorDetail: null,
        cancelled: false,
        updatedAt: "2026-08-01T10:00:00Z",
        createdAt: null,
        completedAt: null,
      },
    });
  });

  it("returns ok with no data when there is no build job", async () => {
    vi.mocked(invoke).mockResolvedValue(connection);
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 200 })),
    );

    expect(await fetchResumableBuildJob()).toEqual({ ok: true, data: null });
  });

  it("treats a completed build job as not resumable", async () => {
    vi.mocked(invoke).mockResolvedValue(connection);
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            id: "job-done",
            status: "succeeded",
            current_stage: "cleanup",
          }),
          { status: 200 },
        ),
      ),
    );

    expect(await fetchResumableBuildJob()).toEqual({ ok: true, data: null });
  });

  it("treats a cancelled build job as not resumable", async () => {
    vi.mocked(invoke).mockResolvedValue(connection);
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            id: "job-cancel",
            status: "cancelled",
            cancelled: true,
          }),
          { status: 200 },
        ),
      ),
    );

    expect(await fetchResumableBuildJob()).toEqual({ ok: true, data: null });
  });

  it("treats a ready human as restorable", () => {
    expect(isHumanReady({ id: "h", name: "n", status: "ready" })).toBe(true);
    expect(isHumanReady({ id: "h", name: "n", status: "building" })).toBe(false);
    expect(isHumanReady(null)).toBe(false);
  });
});