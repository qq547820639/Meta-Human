import { invoke } from "@tauri-apps/api/core";

export interface PortraitInfo {
  readonly format: "jpeg" | "png" | "heic";
  readonly bytes: number;
}

export interface RecordingInfo {
  readonly durationMillis: number;
  readonly sampleRate: number;
  readonly bytes: number;
}

export function validatePortraitFile(
  path: string,
): Promise<PortraitInfo> {
  return invoke<PortraitInfo>("validate_portrait_file", { path });
}

export function validateRecordingFile(
  path: string,
): Promise<RecordingInfo> {
  return invoke<RecordingInfo>("validate_recording_file", { path });
}

export function pickPortraitFile(): Promise<string> {
  return invoke<string>("pick_portrait_file");
}

export function pickRecordingFile(): Promise<string> {
  return invoke<string>("pick_recording_file");
}
