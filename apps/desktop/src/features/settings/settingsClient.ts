import { invoke } from "@tauri-apps/api/core";

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
      throw new Error("换取 Access Token 失败。");
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
