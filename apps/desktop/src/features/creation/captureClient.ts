import { invoke } from "@tauri-apps/api/core";

export type CapturePermission =
  | "notDetermined"
  | "denied"
  | "restricted"
  | "authorized";

export interface CapturePermissionSnapshot {
  readonly camera: CapturePermission;
  readonly microphone: CapturePermission;
}

export function getCapturePermissionStatus(): Promise<CapturePermissionSnapshot> {
  return invoke<CapturePermissionSnapshot>("capture_permission_status");
}

export function capturePortrait(): Promise<string> {
  return invoke<string>("capture_portrait");
}

export function captureRecording(durationSecs?: number): Promise<string> {
  return invoke<string>(
    "capture_recording",
    durationSecs === undefined ? {} : { durationSecs },
  );
}

export function startRecording(): Promise<void> {
  return invoke<void>("start_recording");
}

export function stopRecording(): Promise<string> {
  return invoke<string>("stop_recording");
}

export function deleteMediaFile(path: string): Promise<void> {
  return invoke<void>("delete_media_file", { path });
}

export function deleteCapturedTempMedia(): Promise<number> {
  return invoke<number>("delete_captured_temp_media");
}
