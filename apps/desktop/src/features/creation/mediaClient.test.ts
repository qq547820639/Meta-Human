import { invoke } from "@tauri-apps/api/core";
import { describe, expect, it, vi } from "vitest";

import {
  pickPortraitFile,
  pickRecordingFile,
  validatePortraitFile,
  validateRecordingFile,
} from "./mediaClient";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("mediaClient", () => {
  it("validates portrait files through the native bridge", async () => {
    vi.mocked(invoke).mockResolvedValue({
      format: "png",
      bytes: 128,
    });

    await expect(validatePortraitFile("/tmp/portrait.png")).resolves.toEqual({
      format: "png",
      bytes: 128,
    });
    expect(invoke).toHaveBeenCalledWith("validate_portrait_file", {
      path: "/tmp/portrait.png",
    });
  });

  it("validates recording files through the native bridge", async () => {
    vi.mocked(invoke).mockResolvedValue({
      durationMillis: 1000,
      sampleRate: 16000,
      bytes: 32000,
    });

    await expect(
      validateRecordingFile("/tmp/voice.wav"),
    ).resolves.toEqual({
      durationMillis: 1000,
      sampleRate: 16000,
      bytes: 32000,
    });
    expect(invoke).toHaveBeenCalledWith("validate_recording_file", {
      path: "/tmp/voice.wav",
    });
  });

  it("picks a portrait file through the native dialog", async () => {
    vi.mocked(invoke).mockResolvedValue(
      "/tmp/voxstudio-portrait-1-123.jpg",
    );

    await expect(pickPortraitFile()).resolves.toBe(
      "/tmp/voxstudio-portrait-1-123.jpg",
    );
    expect(invoke).toHaveBeenCalledWith("pick_portrait_file");
  });

  it("picks a recording file through the native dialog", async () => {
    vi.mocked(invoke).mockResolvedValue(
      "/tmp/voxstudio-recording-1-123.wav",
    );

    await expect(pickRecordingFile()).resolves.toBe(
      "/tmp/voxstudio-recording-1-123.wav",
    );
    expect(invoke).toHaveBeenCalledWith("pick_recording_file");
  });
});
