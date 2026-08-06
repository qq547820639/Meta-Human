/**
 * Opens the OS privacy settings for the app's microphone access.
 *
 * The Tauri descriptor does not bundle `@tauri-apps/plugin-opener`, so on macOS
 * we navigate to the System Settings privacy pane for Microphone via the
 * `x-apple.systempreferences:` URL scheme (the same scheme the OS uses for
 * `open "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"`).
 *
 * `open` is injected so tests can assert the URL without a real navigation.
 */

const MAC_MIC_SETTINGS_URL =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone";

export type OpenWindow = (url: string, target?: string) => Window | null;

export function openMicrophoneSettings(
  open: OpenWindow = (url, target) => window.open(url, target),
): boolean {
  try {
    const win = open(MAC_MIC_SETTINGS_URL, "_self");
    return win !== null;
  } catch {
    return false;
  }
}