import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_PROBE_CANDIDATES,
  fetchModelsRaw,
  kindForBaseUrl,
  probeLocalServices,
  serviceLabelForUrl,
} from "./localProbe";

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("localProbe", () => {
  it("classifies known ports as ollama and lmstudio", () => {
    expect(kindForBaseUrl("http://127.0.0.1:11434")).toBe("ollama");
    expect(kindForBaseUrl("http://127.0.0.1:1234")).toBe("lmstudio");
    expect(kindForBaseUrl("http://127.0.0.1:9999")).toBe("generic");
    expect(serviceLabelForUrl("http://127.0.0.1:11434")).toContain("Ollama");
  });

  it("discovers models from the /v1/models payload", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: [
          { id: "llama3" },
          { id: "nomic-embed-text" },
          { id: "" },
        ],
      }),
    );
    const result = await fetchModelsRaw(
      "http://127.0.0.1:11434",
      fetchImpl,
      1000,
    );
    expect(result.error).toBeNull();
    expect(result.models.map((model) => model.id)).toEqual([
      "llama3",
      "nomic-embed-text",
    ]);
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:11434/v1/models",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("maps an HTTP error to an http_<status> code, never claiming success", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("not found", { status: 404 }),
    );
    const result = await fetchModelsRaw(
      "http://127.0.0.1:1234",
      fetchImpl,
      1000,
    );
    expect(result.error).toBe("http_404");
    expect(result.models).toEqual([]);
  });

  it("probes only reachable candidates and reports their models", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes("127.0.0.1:1234")) {
          return new Response("not found", { status: 404 });
        }
        return jsonResponse({ data: [{ id: "llama3" }] });
      }),
    );
    const probes = await probeLocalServices({
      candidates: DEFAULT_PROBE_CANDIDATES,
    });
    const ollama = probes.find((probe) => probe.baseUrl.includes("11434"));
    const lmstudio = probes.find((probe) => probe.baseUrl.includes("1234"));
    expect(ollama?.reachable).toBe(true);
    expect(ollama?.models.map((model) => model.id)).toEqual(["llama3"]);
    expect(lmstudio?.reachable).toBe(false);
    expect(lmstudio?.error).toBe("http_404");
  });

  it("reports connection failures as unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockRejectedValue(
        new Error("fetch failed", { cause: { code: "ECONNREFUSED" } }),
      ),
    );
    const [probe] = await probeLocalServices({
      candidates: ["http://127.0.0.1:11434"],
    });
    expect(probe.reachable).toBe(false);
    expect(probe.error).toBe("connection_refused");
  });
});
