import { invoke } from "@tauri-apps/api/core";

/**
 * App + sidecar diagnostic summary. Rust `get_app_diagnostics` deliberately
 * excludes any secrets/tokens so this is safe to render and to export.
 */
export interface AppDiagnostics {
  readonly name: string;
  readonly version: string;
  readonly channel: string;
  readonly commit: string;
  readonly dataDir: string | null;
  readonly connection: string;
  readonly sidecar: SidecarRuntimeDiagnostics;
}

export interface SidecarRuntimeDiagnostics {
  readonly active: boolean;
  readonly crashed: boolean;
  readonly crashRestarts: number;
  readonly lastExitCode: number | null;
  readonly lastError: string | null;
}

/** Settings summary used in the diagnostic package (no secret values). */
export interface SettingsDiagnosticSummary {
  readonly localBaseUrl: string | null;
  readonly localChatModel: string | null;
  readonly localEmbeddingModel: string | null;
  readonly localSttModel: string | null;
  readonly remoteBaseUrl: string | null;
  readonly remoteTtsVoice: string | null;
  readonly feishuAppId: string | null;
  readonly feishuSpaceId: string | null;
  readonly remoteApiKeySet: boolean;
  readonly feishuAppSecretSet: boolean;
  readonly feishuAccessTokenSet: boolean;
  readonly feishuRefreshTokenSet: boolean;
}

export function getAppDiagnostics(): Promise<AppDiagnostics> {
  return invoke<AppDiagnostics>("get_app_diagnostics");
}

export function saveDiagnosticPackage(
  defaultName: string,
  content: string,
): Promise<string> {
  return invoke<string>("save_text_file", { defaultName, content });
}