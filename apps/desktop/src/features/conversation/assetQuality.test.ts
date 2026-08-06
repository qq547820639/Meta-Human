import { describe, expect, it } from "vitest";

import { assessAvatarAsset } from "./assetQuality";

describe("assessAvatarAsset", () => {
  it("returns no checks and passes for an empty input", () => {
    const assessment = assessAvatarAsset({});
    expect(assessment.checks).toEqual([]);
    expect(assessment.allPass).toBe(true);
  });

  it("passes a good photo and audio asset", () => {
    const assessment = assessAvatarAsset({
      photo: { width: 1024, height: 1024, focus: 0.9 },
      audio: { durationSec: 8, sampleRate: 48_000, hasSilence: false },
    });
    expect(assessment.allPass).toBe(true);
    expect(assessment.checks.every((c) => c.pass)).toBe(true);
  });

  it("flags a substandard photo with specific suggestions", () => {
    const assessment = assessAvatarAsset({
      photo: { width: 320, height: 320, focus: 0.3 },
    });
    const resolution = assessment.checks.find((c) => c.id === "photo_resolution");
    const focus = assessment.checks.find((c) => c.id === "photo_focus");
    expect(resolution?.pass).toBe(false);
    expect(resolution?.suggestion).toContain("512x512");
    expect(focus?.pass).toBe(false);
    expect(focus?.suggestion).toContain("对焦");
    expect(assessment.allPass).toBe(false);
  });

  it("flags a substandard audio asset with specific suggestions", () => {
    const assessment = assessAvatarAsset({
      audio: { durationSec: 1, sampleRate: 8000, hasSilence: true },
    });
    const duration = assessment.checks.find((c) => c.id === "audio_duration");
    const sampleRate = assessment.checks.find((c) => c.id === "audio_sample_rate");
    const silence = assessment.checks.find((c) => c.id === "audio_silence");
    expect(duration?.pass).toBe(false);
    expect(duration?.suggestion).toContain("3 秒");
    expect(sampleRate?.pass).toBe(false);
    expect(sampleRate?.suggestion).toContain("16000Hz");
    expect(silence?.pass).toBe(false);
    expect(silence?.suggestion).toContain("静音");
    expect(assessment.allPass).toBe(false);
  });

  it("only checks the assets that were supplied", () => {
    const photoOnly = assessAvatarAsset({
      photo: { width: 1024, height: 1024, focus: 0.9 },
    });
    expect(photoOnly.checks.map((c) => c.id)).toEqual([
      "photo_resolution",
      "photo_focus",
    ]);
    const audioOnly = assessAvatarAsset({
      audio: { durationSec: 8, sampleRate: 48_000, hasSilence: false },
    });
    expect(audioOnly.checks.map((c) => c.id)).toEqual([
      "audio_duration",
      "audio_sample_rate",
      "audio_silence",
    ]);
  });
});