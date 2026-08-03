import { invoke } from "@tauri-apps/api/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ApiError,
  apiRequest,
  copyRequestId,
  resetSidecarConnection,
} from "./client";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  resetSidecarConnection();
  Object.defineProperty(globalThis, "navigator", {
    value: { clipboard: { writeText: vi.fn() } },
    configurable: true,
  });
});

function stubConnection() {
  vi.mocked(invoke).mockResolvedValue({
    baseUrl: "http://127.0.0.1:43123",
    bearerToken: "startup-token",
  });
}

describe("api client", () => {
  it("performs a GET request and returns parsed JSON", async () => {
    stubConnection();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await apiRequest<{ ok: boolean }>({ path: "/v1/humans" });

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:43123/v1/humans",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer startup-token",
        }),
      }),
    );
  });

  it("serializes a JSON body for POST requests", async () => {
    stubConnection();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("{}", { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await apiRequest({
      method: "POST",
      path: "/v1/humans",
      body: { name: "Meta" },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:43123/v1/humans",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "Meta" }),
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
      }),
    );
  });

  it("appends query parameters", async () => {
    stubConnection();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("[]", { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await apiRequest({ path: "/v1/humans", query: { page: 2, q: "meta" } });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:43123/v1/humans?page=2&q=meta",
      expect.anything(),
    );
  });

  it("returns undefined for 204 responses", async () => {
    stubConnection();
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 })),
    );

    const result = await apiRequest({ method: "DELETE", path: "/v1/humans/1" });

    expect(result).toBeUndefined();
  });

  it("parses the unified error envelope into an ApiError", async () => {
    stubConnection();
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: "credential_error",
            message: "凭证已过期。",
            retryable: true,
            request_id: "req-123",
            recommended_action: "请重新授权。",
            provider: "remote",
            provider_status: "expired",
          }),
          {
            status: 401,
            headers: { "Content-Type": "application/json" },
          },
        ),
      ),
    );

    const error = await apiRequest({ path: "/v1/readiness" }).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.code).toBe("credential_error");
    expect(apiError.message).toBe("凭证已过期。");
    expect(apiError.retryable).toBe(true);
    expect(apiError.requestId).toBe("req-123");
    expect(apiError.recommendedAction).toBe("请重新授权。");
    expect(apiError.provider).toBe("remote");
    expect(apiError.providerStatus).toBe("expired");
    expect(apiError.status).toBe(401);
  });

  it("falls back to the x-request-id header when the body has none", async () => {
    stubConnection();
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response("{}", {
          status: 500,
          headers: { "x-request-id": "req-header" },
        }),
      ),
    );

    const error = await apiRequest({ path: "/v1/readiness" }).catch(
      (e: unknown) => e,
    );

    expect((error as ApiError).requestId).toBe("req-header");
    expect((error as ApiError).retryable).toBe(true);
  });

  it("produces a generic retryable envelope for non-JSON failures", async () => {
    stubConnection();
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(new Response("boom", { status: 503 })),
    );

    const error = await apiRequest({ path: "/v1/humans" }).catch(
      (e: unknown) => e,
    );

    expect((error as ApiError).code).toBe("request_failed");
    expect((error as ApiError).retryable).toBe(true);
    expect((error as ApiError).providerStatus).toBe("unavailable");
  });

  it("forwards an abort signal to fetch", async () => {
    stubConnection();
    const controller = new AbortController();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("{}", { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await apiRequest({ path: "/v1/humans", signal: controller.signal });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:43123/v1/humans",
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it("copies the request id to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis, "navigator", {
      value: { clipboard: { writeText } },
      configurable: true,
    });

    const copied = await copyRequestId(
      new ApiError(
        {
          code: "network_error",
          message: "网络错误。",
          retryable: true,
          request_id: "req-copy",
        },
        503,
      ),
    );

    expect(copied).toBe(true);
    expect(writeText).toHaveBeenCalledWith("req-copy");
  });
});