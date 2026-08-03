import { invoke } from "@tauri-apps/api/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildDigitalHumanId,
  buildIdempotencyKey,
  cancelBuildJob,
  cleanupBuildJob,
  createBuildJob,
  getBuildJob,
  getCurrentBuildJob,
  getDigitalHuman,
  getRecentBuildJob,
  retryBuildJob,
  startAvatarStream,
  stopAvatarStream,
} from "./avatarBuildClient";

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

const runningJob = {
  id: "job-1",
  status: "running",
  current_stage: "enroll_voice",
  stage_progress: null,
  succeeded_stages: ["validate_inputs"],
  retry_count: 0,
  error_code: null,
  error_detail: null,
  cancelled: false,
  digital_human_id: "human-1",
  created_at: "2026-08-04T00:00:00Z",
  updated_at: "2026-08-04T00:00:00Z",
  completed_at: null,
};

describe("avatarBuildClient", () => {
  it("creates a build job on /v1/avatar/jobs with a stable idempotency key", async () => {
    vi.mocked(invoke).mockResolvedValue(connection);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(runningJob, 202));
    vi.stubGlobal("fetch", fetchMock);

    const job = await createBuildJob({
      portraitPath: "/tmp/portrait.jpg",
      recordingPath: "/tmp/voice.wav",
      idempotencyKey: "media-12345678",
      digitalHumanId: "human-1",
    });

    expect(job.id).toBe("job-1");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:43123/v1/avatar/jobs",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer startup-token",
        }),
        body: JSON.stringify({
          portrait_path: "/tmp/portrait.jpg",
          recording_path: "/tmp/voice.wav",
          idempotency_key: "media-12345678",
          digital_human_id: "human-1",
        }),
      }),
    );
  });

  it("derives a stable, non-random idempotency key from the media paths", () => {
    const a = buildIdempotencyKey("/tmp/p.jpg", "/tmp/v.wav");
    const b = buildIdempotencyKey("/tmp/p.jpg", "/tmp/v.wav");
    const c = buildIdempotencyKey("/tmp/p.jpg", "/tmp/v2.wav");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^media-[0-9a-f]{8}$/);
  });

  it("prepares a stable digital human id from the media paths", () => {
    const a = buildDigitalHumanId("/tmp/p.jpg", "/tmp/v.wav");
    const b = buildDigitalHumanId("/tmp/p.jpg", "/tmp/v.wav");
    expect(a).toBe(b);
    expect(a).toMatch(/^human-media-[0-9a-f]{8}$/);
  });

  it("fetches a single build job", async () => {
    vi.mocked(invoke).mockResolvedValue(connection);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(runningJob));
    vi.stubGlobal("fetch", fetchMock);

    const job = await getBuildJob("job-1");

    expect(job.id).toBe("job-1");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:43123/v1/avatar/jobs/job-1",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("fetches the current and recent build jobs", async () => {
    vi.mocked(invoke).mockResolvedValue(connection);
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockImplementation(() => Promise.resolve(jsonResponse(runningJob))),
    );

    await expect(getCurrentBuildJob()).resolves.toMatchObject({ id: "job-1" });
    await expect(getRecentBuildJob()).resolves.toMatchObject({ id: "job-1" });
  });

  it("post-cancels, retries and cleans up a build job through POST", async () => {
    vi.mocked(invoke).mockResolvedValue(connection);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(() => Promise.resolve(jsonResponse(runningJob)));
    vi.stubGlobal("fetch", fetchMock);

    await cancelBuildJob("job-1");
    await retryBuildJob("job-1");
    await cleanupBuildJob("job-1");

    const urls = fetchMock.mock.calls.map((call) => call[0]);
    expect(urls).toEqual([
      "http://127.0.0.1:43123/v1/avatar/jobs/job-1/cancel",
      "http://127.0.0.1:43123/v1/avatar/jobs/job-1/retry",
      "http://127.0.0.1:43123/v1/avatar/jobs/job-1/cleanup",
    ]);
    const methods = fetchMock.mock.calls.map((call) => call[1]?.method);
    expect(methods).toEqual(["POST", "POST", "POST"]);
  });

  it("fetches a digital human record", async () => {
    vi.mocked(invoke).mockResolvedValue(connection);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({ id: "human-1", name: "我的数字人" }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const human = await getDigitalHuman("human-1");

    expect(human.id).toBe("human-1");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:43123/v1/avatar/humans/human-1",
      expect.anything(),
    );
  });

  it("starts and stops an avatar stream", async () => {
    vi.mocked(invoke).mockResolvedValue(connection);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        session_id: "stream-1",
        stream_url: "https://gpu.example.com/live/stream-1",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const stream = await startAvatarStream("avatar-1", "voice-1");
    expect(stream).toEqual({
      sessionId: "stream-1",
      streamUrl: "https://gpu.example.com/live/stream-1",
    });

    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await stopAvatarStream("stream-1");
    expect(fetchMock).toHaveBeenLastCalledWith(
      "http://127.0.0.1:43123/v1/avatar/streams/stream-1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});