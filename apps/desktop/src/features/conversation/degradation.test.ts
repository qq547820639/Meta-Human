import { describe, expect, it } from "vitest";

import {
  choosePresentationMode,
  MAX_DEGRADATION_LEVEL,
  nextDegradationLevel,
  shouldAttemptRecovery,
} from "./degradation";

describe("choosePresentationMode", () => {
  it("prefers full video at level 0 when video is ready", () => {
    expect(
      choosePresentationMode({
        videoReady: true,
        audioReady: true,
        staticReady: true,
        degradedLevel: 0,
      }),
    ).toBe("video");
  });

  it("degrades to audio at level 1", () => {
    expect(
      choosePresentationMode({
        videoReady: true,
        audioReady: true,
        staticReady: true,
        degradedLevel: 1,
      }),
    ).toBe("audio");
  });

  it("degrades to the static portrait at level 2", () => {
    expect(
      choosePresentationMode({
        videoReady: true,
        audioReady: true,
        staticReady: true,
        degradedLevel: 2,
      }),
    ).toBe("static");
  });

  it("degrades to text at level 3", () => {
    expect(
      choosePresentationMode({
        videoReady: true,
        audioReady: true,
        staticReady: true,
        degradedLevel: 3,
      }),
    ).toBe("text");
  });

  it("falls back to the richest ready asset when the preferred one is missing", () => {
    // Level 0 but video not ready -> audio (still richer than static).
    expect(
      choosePresentationMode({
        videoReady: false,
        audioReady: true,
        staticReady: true,
        degradedLevel: 0,
      }),
    ).toBe("audio");
    // Level 1 but audio not ready -> static.
    expect(
      choosePresentationMode({
        videoReady: false,
        audioReady: false,
        staticReady: true,
        degradedLevel: 1,
      }),
    ).toBe("static");
    // Nothing ready -> text.
    expect(
      choosePresentationMode({
        videoReady: false,
        audioReady: false,
        staticReady: false,
        degradedLevel: 0,
      }),
    ).toBe("text");
  });
});

describe("nextDegradationLevel", () => {
  it("escalates one tier when the video stalls", () => {
    expect(nextDegradationLevel(true, false, 0)).toBe(1);
    expect(nextDegradationLevel(true, false, 1)).toBe(2);
  });

  it("escalates one tier when the audio fails", () => {
    expect(nextDegradationLevel(false, true, 1)).toBe(2);
  });

  it("escalates two tiers when both video and audio fail", () => {
    expect(nextDegradationLevel(true, true, 1)).toBe(3);
  });

  it("caps the level at the maximum", () => {
    expect(nextDegradationLevel(true, true, 2)).toBe(MAX_DEGRADATION_LEVEL);
    expect(nextDegradationLevel(true, true, MAX_DEGRADATION_LEVEL)).toBe(
      MAX_DEGRADATION_LEVEL,
    );
  });

  it("stays put when nothing failed", () => {
    expect(nextDegradationLevel(false, false, 2)).toBe(2);
  });
});

describe("shouldAttemptRecovery", () => {
  it("never recovers from a healthy level 0", () => {
    expect(shouldAttemptRecovery(0, null, 10_000, 0)).toBe(false);
    expect(shouldAttemptRecovery(0, 1000, 10_000, 99_000)).toBe(false);
  });

  it("recovers immediately when there has been no recorded failure", () => {
    expect(shouldAttemptRecovery(2, null, 10_000, 0)).toBe(true);
  });

  it("gates recovery behind the cooldown", () => {
    const cooldownMs = 10_000;
    // Within cooldown -> no.
    expect(shouldAttemptRecovery(2, 1000, cooldownMs, 5000)).toBe(false);
    // Right at the cooldown boundary -> yes.
    expect(shouldAttemptRecovery(2, 1000, cooldownMs, 11_000)).toBe(true);
  });
});