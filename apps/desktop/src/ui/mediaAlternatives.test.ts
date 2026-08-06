import { describe, expect, it } from "vitest";

import {
  liveStatusLabel,
  requiresSubtitle,
  textAlternativeFor,
} from "./mediaAlternatives";

describe("requiresSubtitle", () => {
  it("requires a subtitle when audio carries speech", () => {
    expect(requiresSubtitle({ hasAudio: true, hasSpeech: true })).toBe(true);
  });

  it("does not require a subtitle for instrumental audio", () => {
    expect(requiresSubtitle({ hasAudio: true, hasSpeech: false })).toBe(false);
  });

  it("does not require a subtitle when there is no audio", () => {
    expect(requiresSubtitle({ hasAudio: false, hasSpeech: true })).toBe(false);
  });
});

describe("textAlternativeFor", () => {
  it("describes when audio is unavailable", () => {
    expect(
      textAlternativeFor({ audioAvailable: false, hasCaption: false }),
    ).toContain("没有音频");
  });

  it("describes captioned audio", () => {
    expect(
      textAlternativeFor({ audioAvailable: true, hasCaption: true }),
    ).toContain("字幕");
  });

  it("warns when audio is present but has no caption", () => {
    expect(
      textAlternativeFor({ audioAvailable: true, hasCaption: false }),
    ).toContain("未提供字幕");
  });
});

describe("liveStatusLabel", () => {
  it("maps streaming phases to declarative labels", () => {
    expect(liveStatusLabel("listening", { role: "status" })).toContain("聆听");
    expect(liveStatusLabel("thinking", { role: "status" })).toContain("思考");
    expect(liveStatusLabel("speaking", { role: "status" })).toContain("说话");
    expect(liveStatusLabel("interrupted", { role: "status" })).toContain("打断");
  });

  it("falls back to a readable label for unknown states", () => {
    expect(liveStatusLabel("weird", { role: "status" })).toContain("状态");
  });

  it("adds an urgent prefix for alert regions", () => {
    expect(liveStatusLabel("error", { role: "alert" })).toContain("注意");
    expect(liveStatusLabel("error", { role: "status" })).not.toContain("注意");
  });
});