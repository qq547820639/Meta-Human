import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  capturePortrait,
  captureRecording,
  deleteCapturedTempMedia,
  deleteMediaFile,
  getCapturePermissionStatus,
  startRecording,
  stopRecording,
} from "./captureClient";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("captureClient", () => {
  it("reads capture permissions through the native bridge", async () => {
    vi.mocked(invoke).mockResolvedValue({
      camera: "notDetermined",
      microphone: "notDetermined",
    });

    await expect(getCapturePermissionStatus()).resolves.toEqual({
      camera: "notDetermined",
      microphone: "notDetermined",
    });
    expect(invoke).toHaveBeenCalledWith("capture_permission_status");
  });

  it("captures a portrait through the native bridge", async () => {
    vi.mocked(invoke).mockResolvedValue("/tmp/captured-portrait.jpg");

    await expect(capturePortrait()).resolves.toBe(
      "/tmp/captured-portrait.jpg",
    );
    expect(invoke).toHaveBeenCalledWith("capture_portrait");
  });

  it("captures a recording through the native bridge", async () => {
    vi.mocked(invoke).mockResolvedValue("/tmp/captured-voice.wav");

    await expect(captureRecording()).resolves.toBe(
      "/tmp/captured-voice.wav",
    );
    expect(invoke).toHaveBeenCalledWith("capture_recording", {});

    await expect(captureRecording(12)).resolves.toBe(
      "/tmp/captured-voice.wav",
    );
    expect(invoke).toHaveBeenLastCalledWith("capture_recording", {
      durationSecs: 12,
    });
  });

  it("starts and stops a user-controlled recording session", async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce("/tmp/voice.wav");

    await startRecording();
    await expect(stopRecording()).resolves.toBe("/tmp/voice.wav");

    expect(invoke).toHaveBeenNthCalledWith(1, "start_recording");
    expect(invoke).toHaveBeenNthCalledWith(2, "stop_recording");
  });

  it("deletes temporary media through the native bridge", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);

    await deleteMediaFile("/tmp/voice.wav");

    expect(invoke).toHaveBeenCalledWith("delete_media_file", {
      path: "/tmp/voice.wav",
    });
  });

  it("deletes captured temp media through the native bridge", async () => {
    vi.mocked(invoke).mockResolvedValue(2);

    await expect(deleteCapturedTempMedia()).resolves.toBe(2);

    expect(invoke).toHaveBeenCalledWith("delete_captured_temp_media");
  });
});
