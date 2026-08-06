import { describe, expect, it, vi } from "vitest";

import { fullyInterrupt } from "./naturalConversationCore";

describe("fullyInterrupt", () => {
  it("calls stopAudio, stopAvatar, aborts in-flight and cancels the generation together", () => {
    const abortInFlight = vi.fn();
    const cancelGeneration = vi.fn().mockResolvedValue(true);
    const stopAudio = vi.fn();
    const stopAvatar = vi.fn();

    fullyInterrupt({
      abortInFlight,
      cancelGeneration,
      stopAudio,
      stopAvatar,
      generationId: "gen-9",
    });

    expect(abortInFlight).toHaveBeenCalledTimes(1);
    expect(cancelGeneration).toHaveBeenCalledWith("gen-9");
    expect(stopAudio).toHaveBeenCalledTimes(1);
    expect(stopAvatar).toHaveBeenCalledTimes(1);
  });

  it("still stops audio + avatar when there is no in-flight generation id", () => {
    const abortInFlight = vi.fn();
    const cancelGeneration = vi.fn().mockResolvedValue(true);
    const stopAudio = vi.fn();
    const stopAvatar = vi.fn();

    fullyInterrupt({
      abortInFlight,
      cancelGeneration,
      stopAudio,
      stopAvatar,
      generationId: null,
    });

    expect(abortInFlight).toHaveBeenCalledTimes(1);
    expect(cancelGeneration).not.toHaveBeenCalled();
    expect(stopAudio).toHaveBeenCalledTimes(1);
    expect(stopAvatar).toHaveBeenCalledTimes(1);
  });

  it("propagates a rejected sidecar cancel without throwing (best-effort)", () => {
    const abortInFlight = vi.fn();
    const cancelGeneration = vi.fn().mockRejectedValue(new Error("network"));
    const stopAudio = vi.fn();
    const stopAvatar = vi.fn();

    // The rejection is swallowed (void'd) so the interrupt flow never throws.
    expect(() =>
      fullyInterrupt({
        abortInFlight,
        cancelGeneration,
        stopAudio,
        stopAvatar,
        generationId: "gen-1",
      }),
    ).not.toThrow();
    expect(stopAudio).toHaveBeenCalledTimes(1);
    expect(stopAvatar).toHaveBeenCalledTimes(1);
  });
});