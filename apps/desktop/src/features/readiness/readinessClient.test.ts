import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  deriveReadinessSnapshot,
  getReadinessSnapshot,
} from "./readinessClient";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("getReadinessSnapshot", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it("invokes the authoritative readiness command exactly", async () => {
    const snapshot = {
      requirements: [],
      canCreate: false,
    };
    vi.mocked(invoke).mockResolvedValue(snapshot);

    await expect(getReadinessSnapshot()).resolves.toEqual(snapshot);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("get_readiness_snapshot");
  });

  it("sends only mapped requirements to the Rust derivation command", async () => {
    const requirements = [
      { id: "conversation" as const, required: true, state: "passed" as const },
      { id: "voicePresence" as const, required: true, state: "passed" as const },
      { id: "knowledge" as const, required: true, state: "passed" as const },
    ];
    const snapshot = { requirements, canCreate: true };
    vi.mocked(invoke).mockResolvedValue(snapshot);

    await expect(deriveReadinessSnapshot(requirements)).resolves.toEqual(snapshot);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("derive_readiness_snapshot", {
      requirements,
    });
    expect(invoke).not.toHaveBeenCalledWith(
      "derive_readiness_snapshot",
      expect.objectContaining({ canCreate: expect.anything() }),
    );
  });
});
