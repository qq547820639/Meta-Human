import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  READINESS_REQUEST_TIMEOUT_MS,
  SidecarReadinessError,
  getSidecarReadinessSnapshot,
  startOrResumeSidecarReadiness,
} from "./sidecarReadinessClient";
import type { SidecarReadinessSnapshot } from "./types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const token = "startup-secret-token";
const connection = {
  baseUrl: "http://127.0.0.1:43123",
  bearerToken: token,
};

function snapshot(
  state: SidecarReadinessSnapshot["state"] = "checking",
): SidecarReadinessSnapshot {
  return {
    id: "run-1",
    state,
    gate_open: state === "ready",
    outcomes: [
      {
        id: "conversation",
        required: true,
        state,
        capabilities: [],
      },
      {
        id: "voicePresence",
        required: true,
        state,
        capabilities: [],
      },
      {
        id: "knowledge",
        required: true,
        state,
        capabilities: [],
      },
    ],
    capabilities: [],
    created_at: "2026-08-01T09:30:00Z",
    updated_at: "2026-08-01T09:30:00Z",
    completed_at: null,
  };
}

describe("sidecarReadinessClient", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue(connection);
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("gets the native connection and confines its token to Authorization", async () => {
    const expected = snapshot("ready");
    const controller = new AbortController();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(expected), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(
      getSidecarReadinessSnapshot(controller.signal),
    ).resolves.toEqual(expected);

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("get_sidecar_connection");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:43123/readyz",
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        signal: expect.any(AbortSignal),
      },
    );
    const [url, request] = fetchMock.mock.calls[0];
    expect(String(url)).not.toContain(token);
    expect(request).not.toHaveProperty("body");
  });

  it("starts readiness with a bodyless POST and no unnecessary content type", async () => {
    const expected = snapshot("pending");
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(expected), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(startOrResumeSidecarReadiness()).resolves.toEqual(expected);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:43123/v1/readiness/runs",
      expect.objectContaining({
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
      }),
    );
    const request = fetchMock.mock.calls[0][1];
    expect(request).not.toHaveProperty("body");
    expect(request?.headers).not.toHaveProperty("Content-Type");
  });

  it("resolves a typed readiness snapshot from the expected 503 gate response", async () => {
    const expected = snapshot("degraded");
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(expected), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(getSidecarReadinessSnapshot()).resolves.toEqual(expected);
  });

  it("maps only the safe error envelope and never retains raw response fields", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "readiness_not_accepting",
          message: "Readiness preparation is stopping.",
          retryable: true,
          request_id: "request-123",
          recommended_action: "Wait a moment, then try again.",
          unsafe_debug: token,
        }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      ),
    );

    const error = await getSidecarReadinessSnapshot().catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(SidecarReadinessError);
    expect(error).toMatchObject({
      status: 409,
      code: "readiness_not_accepting",
      message: "Readiness preparation is stopping.",
      retryable: true,
      requestId: "request-123",
      recommendedAction: "Wait a moment, then try again.",
    });
    expect(String(error)).not.toContain(token);
    expect(JSON.stringify(error)).not.toContain(token);
    expect(error).not.toHaveProperty("unsafe_debug");
  });

  it("falls back to a fixed safe error when the error body is not an envelope", async () => {
    fetchMock.mockResolvedValue(new Response(token, { status: 502 }));

    const error = await getSidecarReadinessSnapshot().catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(SidecarReadinessError);
    expect(error).toMatchObject({
      status: 502,
      code: "readiness_request_failed",
      retryable: true,
    });
    expect(String(error)).not.toContain(token);
    expect(JSON.stringify(error)).not.toContain(token);
  });

  it("propagates caller abort without replacing the AbortError", async () => {
    const controller = new AbortController();
    const abortError = new DOMException("The operation was aborted.", "AbortError");
    fetchMock.mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(init.signal?.reason);
          });
        }),
    );

    const pending = getSidecarReadinessSnapshot(controller.signal);
    controller.abort(abortError);

    await expect(pending).rejects.toBe(abortError);
  });

  it("maps a bounded fetch timeout to a retryable safe error", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(init.signal?.reason);
          });
        }),
    );

    const pending = getSidecarReadinessSnapshot();
    const errorPromise = pending.catch((caught: unknown) => caught);
    await vi.advanceTimersByTimeAsync(READINESS_REQUEST_TIMEOUT_MS);
    const error = await errorPromise;

    expect(error).toBeInstanceOf(SidecarReadinessError);
    expect(error).toMatchObject({
      status: null,
      code: "readiness_timeout",
      retryable: true,
    });
    expect(String(error)).not.toContain(token);
  });

  it("surfaces a failed-closed connection as a distinct non-retryable error", async () => {
    vi.mocked(invoke).mockRejectedValue("sidecar connection failed closed");

    const error = await getSidecarReadinessSnapshot().catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(SidecarReadinessError);
    expect(error).toMatchObject({
      status: null,
      code: "readiness_failed_closed",
      retryable: false,
    });
  });
});
