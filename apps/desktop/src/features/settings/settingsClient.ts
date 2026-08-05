import { invoke } from "@tauri-apps/api/core";

import { apiRequest, toApiError } from "../../api/client";

export interface AppSettings {
  readonly localBaseUrl?: string | null;
  readonly localChatModel?: string | null;
  readonly localEmbeddingModel?: string | null;
  readonly localSttModel?: string | null;
  readonly localTimeoutSeconds?: number | null;
  readonly remoteBaseUrl?: string | null;
  readonly remoteTtsVoice?: string | null;
  readonly remoteVoiceEnrollPath?: string | null;
  readonly remoteAvatarEnrollPath?: string | null;
  readonly remoteAvatarStreamPath?: string | null;
  readonly remoteAvatarStreamStopPath?: string | null;
  readonly remoteTtsPath?: string | null;
  readonly feishuAppId?: string | null;
  readonly feishuSpaceId?: string | null;
  readonly feishuBaseUrl?: string | null;
}

export interface AppSettingsView {
  readonly settings: AppSettings;
  readonly remoteApiKeySet: boolean;
  readonly feishuAppSecretSet: boolean;
  readonly feishuAccessTokenSet: boolean;
  readonly feishuRefreshTokenSet: boolean;
}

export interface AppSecretsInput {
  readonly remoteApiKey?: string;
  readonly feishuAppSecret?: string;
  readonly feishuAccessToken?: string;
  readonly feishuRefreshToken?: string;
}

export type SecretKind =
  | "remoteApiKey"
  | "feishuAppSecret"
  | "feishuAccessToken"
  | "feishuRefreshToken";

export interface SecretFlags {
  readonly remoteApiKeySet: boolean;
  readonly feishuAppSecretSet: boolean;
  readonly feishuAccessTokenSet: boolean;
  readonly feishuRefreshTokenSet: boolean;
}

export interface FeishuTokenBundle {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: string;
}

export function loadAppSettings(): Promise<AppSettingsView> {
  return invoke<AppSettingsView>("load_app_settings");
}

export function saveAppSettings(
  settings: AppSettings,
  secrets: AppSecretsInput,
): Promise<void> {
  return invoke<void>("save_app_settings", {
    settings,
    remoteApiKey: secrets.remoteApiKey,
    feishuAppSecret: secrets.feishuAppSecret,
    feishuAccessToken: secrets.feishuAccessToken,
    feishuRefreshToken: secrets.feishuRefreshToken,
  });
}

export function restartSidecar(): Promise<void> {
  return invoke<void>("restart_sidecar");
}

export function resetAllSettings(): Promise<void> {
  return invoke<void>("reset_all_settings");
}

export function checkLocalProvider(url: string): Promise<boolean> {
  return invoke<boolean>("check_local_provider", { url });
}

export function checkRemoteProvider(url: string): Promise<boolean> {
  return invoke<boolean>("check_remote_provider", { url });
}

export function openFeishuAuthorization(
  appId: string,
  redirectUri: string,
): Promise<string> {
  return invoke<string>("open_feishu_authorization", {
    appId,
    redirectUri,
  });
}

export function exchangeFeishuCode(
  code: string,
  appId: string,
  appSecret: string,
  redirectUri: string,
): Promise<FeishuTokenBundle> {
  return invoke<{
    baseUrl: string;
    bearerToken: string;
  }>("get_sidecar_connection").then(async (connection) => {
    const response = await fetch(
      `${connection.baseUrl}/v1/feishu/oauth/token`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${connection.bearerToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          code,
          app_id: appId,
          app_secret: appSecret,
          redirect_uri: redirectUri,
        }),
        credentials: "omit",
        cache: "no-store",
      },
    );
    if (!response.ok) {
      throw await toApiError(response);
    }
    const body = (await response.json()) as {
      access_token: string;
      refresh_token: string;
      expires_at: string;
    };
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      expiresAt: body.expires_at,
    };
  });
}

export function startFeishuOauth(
  appId: string,
): Promise<string> {
  return invoke<string>("start_feishu_oauth", {
    appId,
  });
}

/** Opens the operating-system privacy & permissions settings (best effort). */
export function openSystemPermissions(): Promise<void> {
  return invoke<void>("open_system_permissions");
}

/** Provider types accepted by the unified provider deep-verification endpoint. */
export type ProviderType =
  | "ollama"
  | "lmstudio"
  | "remote_gpu"
  | "feishu"
  | "stt"
  | "tts"
  | "llm";

/** A single step of a deep provider verification, as returned by the backend. */
export interface ProviderVerifyStep {
  readonly id: string;
  readonly label: string;
  readonly status: "pass" | "fail" | "skip";
  readonly latency_ms?: number;
  readonly detail?: string;
}

/**
 * Result of the unified provider deep-verification endpoint
 * (POST /v1/providers/verify). Optional/non-deterministic fields are null.
 */
export interface ProviderVerification {
  readonly provider_type: string;
  readonly status: "ok" | "failed" | "unconfigured";
  readonly current_step: string | null;
  readonly endpoint: string | null;
  readonly network_reachable: boolean | null;
  readonly tls_status:
    | "ok"
    | "insecure"
    | "not_applicable"
    | null;
  readonly auth_status:
    | "ok"
    | "invalid_credentials"
    | "not_configured"
    | "not_applicable"
    | null;
  readonly permission_status:
    | "ok"
    | "insufficient_permission"
    | "not_configured"
    | "not_applicable"
    | null;
  readonly api_version_compatible: boolean | null;
  readonly model_exists: boolean | null;
  readonly model_capabilities: string[];
  readonly first_response_latency_ms: number | null;
  readonly total_duration_ms: number;
  readonly recoverable: boolean | null;
  readonly recommended_action: string | null;
  readonly error_trace_id: string | null;
  readonly steps: ProviderVerifyStep[];
  readonly verified_at: string;
}

/** Request body for the provider deep-verification endpoint (snake_case). */
export interface ProviderVerifyDeepInput {
  readonly endpoint?: string;
  readonly api_key?: string;
  readonly model?: string;
  readonly space_id?: string;
  readonly app_id?: string;
  readonly app_secret?: string;
  readonly access_token?: string;
  readonly refresh_token?: string;
  readonly timeout_seconds?: number;
}

/**
 * Runs the unified provider deep verification against the sidecar
 * (POST /v1/providers/verify) and returns the typed result.
 */
export function verifyProviderDeep(
  providerType: ProviderType,
  input: ProviderVerifyDeepInput,
  signal?: AbortSignal,
): Promise<ProviderVerification> {
  return apiRequest<ProviderVerification>({
    method: "POST",
    path: "/v1/providers/verify",
    body: { provider_type: providerType, ...input },
    signal,
  });
}

/** Lists the provider types supported by the backend (GET /v1/providers/types). */
export async function listProviderTypes(): Promise<string[]> {
  const body = await apiRequest<{ providers: string[] }>({
    method: "GET",
    path: "/v1/providers/types",
  });
  return body.providers;
}
