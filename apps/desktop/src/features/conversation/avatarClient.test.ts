import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../api/client";
import {
  avatarSessionFromResult,
  detectStreamType,
  isAllowedStreamUrl,
  startAvatarSession,
  stopAvatarSession,
} from "./avatarClient";

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

describe("isAllowedStreamUrl", () => {
  it("allows the sidecar loopback proxy", () => {
    expect(isAllowedStreamUrl("http://127.0.0.1:43123/v1/avatar/stream/1/play")).toBe(
      true,
    );
    expect(isAllowedStreamUrl("http://localhost:43123/stream.m3u8")).toBe(true);
    expect(isAllowedStreamUrl("http://asset.localhost/stream")).toBe(true);
  });

  it("rejects arbitrary / untrusted URLs", () => {
    expect(isAllowedStreamUrl("https://evil.example.com/stream")).toBe(false);
    expect(isAllowedStreamUrl("http://192.168.1.10/stream")).toBe(false);
    expect(isAllowedStreamUrl("ftp://127.0.0.1/stream")).toBe(false);
    expect(isAllowedStreamUrl("not-a-url")).toBe(false);
    expect(isAllowedStreamUrl(null)).toBe(false);
    expect(isAllowedStreamUrl(undefined)).toBe(false);
  });

  it("allows a configured provider origin", () => {
    const origins = ["https://avatar.myprovider.com"];
    expect(
      isAllowedStreamUrl("https://avatar.myprovider.com/live/abc", origins),
    ).toBe(true);
    expect(
      isAllowedStreamUrl("https://other.myprovider.com/live/abc", origins),
    ).toBe(false);
  });
});

describe("detectStreamType", () => {
  it("detects HLS streams", () => {
    expect(detectStreamType("http://127.0.0.1:43123/live/index.m3u8")).toBe(
      "hls",
    );
  });

  it("detects WebRTC signal URLs", () => {
    expect(detectStreamType("wss://relay.example.com?transport=webrtc")).toBe(
      "webrtc",
    );
    expect(detectStreamType("webrtc://signaling.example.com/room")).toBe(
      "webrtc",
    );
  });

  it("detects plain media (http/https) and unknown", () => {
    expect(detectStreamType("http://127.0.0.1:43123/video.mp4")).toBe("media");
    expect(detectStreamType("https://cdn.example.com/video.webm")).toBe("media");
    expect(detectStreamType("not-a-url")).toBe("unknown");
    expect(detectStreamType(null)).toBe("unknown");
    expect(detectStreamType(undefined)).toBe("unknown");
  });
});

describe("startAvatarSession", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockResolvedValue(connection);
  });

  it("starts a real session and wraps it in an AvatarSession", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          session_id: "sess-1",
          stream_url: "http://127.0.0.1:43123/v1/avatar/streams/sess-1/play",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const session = await startAvatarSession({
      avatarId: "avatar-1",
      voiceId: "voice-1",
    });

    expect(session.sessionId).toBe("sess-1");
    expect(session.avatarId).toBe("avatar-1");
    expect(session.voiceId).toBe("voice-1");
    expect(session.status).toBe("ready");
    expect(session.streamUrl).toContain("sess-1");
    expect(session.createdAt).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:43123/v1/avatar/streams",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ avatar_id: "avatar-1", voice_id: "voice-1" }),
        headers: expect.objectContaining({
          Authorization: "Bearer startup-token",
        }),
      }),
    );
  });

  it("surfaces an honest error when the stream service is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: "stream_service_unavailable",
            message: "未配置直播服务。",
            retryable: true,
            request_id: "req-unavailable",
          }),
          { status: 503, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    await expect(
      startAvatarSession({ avatarId: "a", voiceId: "v" }),
    ).rejects.toMatchObject({
      code: "stream_service_unavailable",
      status: 503,
    });
  });

  it("aborts a stalled start on timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockImplementation(
        () => new Promise<Response>(() => {}), // never settles
      ),
    );

    await expect(
      startAvatarSession({ avatarId: "a", voiceId: "v", timeoutMs: 20 }),
    ).rejects.toThrow("avatar-session-start-timeout");
  });
});

describe("stopAvatarSession", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockResolvedValue(connection);
  });

  it("deletes the remote session", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, { status: 204 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await stopAvatarSession("sess-1");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:43123/v1/avatar/streams/sess-1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});

describe("avatarSessionFromResult", () => {
  it("wraps a wizard-started stream into a full session", () => {
    const session = avatarSessionFromResult(
      { sessionId: "wiz-1", streamUrl: "http://127.0.0.1:43123/stream" },
      "avatar-1",
      "voice-1",
    );
    expect(session.sessionId).toBe("wiz-1");
    expect(session.avatarId).toBe("avatar-1");
    expect(session.voiceId).toBe("voice-1");
    expect(session.status).toBe("ready");
    expect(session.authNote).toBe("wizard-started-session");
  });
});