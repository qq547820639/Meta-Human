import { invoke } from "@tauri-apps/api/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildAvatar,
  startAvatarStream,
  stopAvatarStream,
} from "./avatarBuildClient";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("avatarBuildClient", () => {
  it("posts captured media paths to the avatar build API", async () => {
    vi.mocked(invoke).mockResolvedValue({
      baseUrl: "http://127.0.0.1:43123",
      bearerToken: "startup-token",
    });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          voice_id: "voice-1",
          avatar_id: "avatar-1",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await buildAvatar(
      "/tmp/portrait.jpg",
      "/tmp/voice.wav",
    );

    expect(result).toEqual({ voiceId: "voice-1", avatarId: "avatar-1" });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:43123/v1/avatar/builds",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer startup-token",
        }),
      }),
    );
  });

  it("fails closed when the build service rejects", async () => {
    vi.mocked(invoke).mockResolvedValue({
      baseUrl: "http://127.0.0.1:43123",
      bearerToken: "startup-token",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response("{}", { status: 503 }),
      ),
    );

    await expect(
      buildAvatar("/tmp/portrait.jpg", "/tmp/voice.wav"),
    ).rejects.toThrow("头像构建服务暂时不可用。");
  });

  it("starts an avatar stream and returns the stream URL", async () => {
    vi.mocked(invoke).mockResolvedValue({
      baseUrl: "http://127.0.0.1:43123",
      bearerToken: "startup-token",
    });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          session_id: "stream-1",
          stream_url: "https://gpu.example.com/live/stream-1",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const stream = await startAvatarStream("avatar-1", "voice-1");

    expect(stream).toEqual({
      sessionId: "stream-1",
      streamUrl: "https://gpu.example.com/live/stream-1",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:43123/v1/avatar/streams",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          avatar_id: "avatar-1",
          voice_id: "voice-1",
        }),
      }),
    );
  });

  it("stops an avatar stream through DELETE", async () => {
    vi.mocked(invoke).mockResolvedValue({
      baseUrl: "http://127.0.0.1:43123",
      bearerToken: "startup-token",
    });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, { status: 204 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await stopAvatarStream("stream-1");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:43123/v1/avatar/streams/stream-1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});
