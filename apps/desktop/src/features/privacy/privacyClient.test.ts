import { invoke } from "@tauri-apps/api/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { clearAllLocalData } from "./privacyClient";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("privacyClient", () => {
  it("clears local data through the sidecar", async () => {
    vi.mocked(invoke).mockResolvedValue({
      baseUrl: "http://127.0.0.1:43123",
      bearerToken: "startup-token",
    });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ cleared: true }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await clearAllLocalData();

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:43123/v1/privacy/data",
      expect.objectContaining({
        method: "DELETE",
        headers: expect.objectContaining({
          Authorization: "Bearer startup-token",
        }),
      }),
    );
  });
});
