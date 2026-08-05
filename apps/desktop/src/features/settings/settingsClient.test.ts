import { invoke } from "@tauri-apps/api/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  checkLocalProvider,
  checkRemoteProvider,
  exchangeFeishuCode,
  listProviderTypes,
  loadAppSettings,
  openFeishuAuthorization,
  resetAllSettings,
  restartSidecar,
  saveAppSettings,
  startFeishuOauth,
  verifyProviderDeep,
} from "./settingsClient";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("settingsClient", () => {
  it("loads settings through the native bridge", async () => {
    vi.mocked(invoke).mockResolvedValue({
      settings: { localBaseUrl: "http://127.0.0.1:11434" },
      remoteApiKeySet: true,
      feishuAppSecretSet: false,
      feishuAccessTokenSet: false,
      feishuRefreshTokenSet: false,
    });

    const view = await loadAppSettings();

    expect(view.settings.localBaseUrl).toBe("http://127.0.0.1:11434");
    expect(view.remoteApiKeySet).toBe(true);
    expect(invoke).toHaveBeenCalledWith("load_app_settings");
  });

  it("saves settings and secrets through the native bridge", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);

    await saveAppSettings(
      { localBaseUrl: "http://127.0.0.1:11434" },
      { remoteApiKey: "secret" },
    );

    expect(invoke).toHaveBeenCalledWith("save_app_settings", {
      settings: { localBaseUrl: "http://127.0.0.1:11434" },
      remoteApiKey: "secret",
      feishuAppSecret: undefined,
      feishuAccessToken: undefined,
      feishuRefreshToken: undefined,
    });
  });

  it("checks a local provider address through the native bridge", async () => {
    vi.mocked(invoke).mockResolvedValue(true);

    await expect(
      checkLocalProvider("http://127.0.0.1:11434"),
    ).resolves.toBe(true);
    expect(invoke).toHaveBeenCalledWith("check_local_provider", {
      url: "http://127.0.0.1:11434",
    });
  });

  it("checks a remote provider address through the native bridge", async () => {
    vi.mocked(invoke).mockResolvedValue(true);

    await expect(
      checkRemoteProvider("https://gpu.example.com"),
    ).resolves.toBe(true);
    expect(invoke).toHaveBeenCalledWith("check_remote_provider", {
      url: "https://gpu.example.com",
    });
  });

  it("restarts the sidecar through the native bridge", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);

    await restartSidecar();

    expect(invoke).toHaveBeenCalledWith("restart_sidecar");
  });

  it("resets all settings through the native bridge", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);

    await resetAllSettings();

    expect(invoke).toHaveBeenCalledWith("reset_all_settings");
  });

  it("opens Feishu authorization through the native bridge", async () => {
    vi.mocked(invoke).mockResolvedValue("https://open.feishu.cn/authorize");
    await expect(
      openFeishuAuthorization("cli_app", "http://127.0.0.1:1420/oauth/feishu"),
    ).resolves.toBe("https://open.feishu.cn/authorize");
    expect(invoke).toHaveBeenCalledWith("open_feishu_authorization", {
      appId: "cli_app",
      redirectUri: "http://127.0.0.1:1420/oauth/feishu",
    });
  });

  it("exchanges the Feishu code through the loopback sidecar", async () => {
    vi.mocked(invoke).mockResolvedValue({
      baseUrl: "http://127.0.0.1:43123",
      bearerToken: "startup-token",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            access_token: "access-token",
            refresh_token: "refresh-token",
            expires_at: "2026-08-03T00:00:00Z",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const bundle = await exchangeFeishuCode(
      "code-1",
      "cli_app",
      "secret",
      "http://127.0.0.1:1420/oauth/feishu",
    );

    expect(bundle).toEqual({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresAt: "2026-08-03T00:00:00Z",
    });
    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:43123/v1/feishu/oauth/token",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer startup-token",
        }),
        body: JSON.stringify({
          code: "code-1",
          app_id: "cli_app",
          app_secret: "secret",
          redirect_uri: "http://127.0.0.1:1420/oauth/feishu",
        }),
      }),
    );
  });

  it("starts the browser-based Feishu OAuth flow", async () => {
    vi.mocked(invoke).mockResolvedValue("code-1");

    await expect(startFeishuOauth("cli_app")).resolves.toBe("code-1");
    expect(invoke).toHaveBeenCalledWith("start_feishu_oauth", {
      appId: "cli_app",
    });
  });

  it("deep-verifies a provider through the unified API client", async () => {
    vi.mocked(invoke).mockResolvedValue({
      baseUrl: "http://127.0.0.1:43123",
      bearerToken: "startup-token",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            provider_type: "ollama",
            status: "failed",
            current_step: "auth",
            endpoint: "http://127.0.0.1:11434",
            network_reachable: true,
            tls_status: "not_applicable",
            auth_status: "invalid_credentials",
            permission_status: "not_applicable",
            api_version_compatible: null,
            model_exists: null,
            model_capabilities: [],
            first_response_latency_ms: null,
            total_duration_ms: 12,
            recoverable: true,
            recommended_action: "检查 API Key",
            error_trace_id: null,
            steps: [
              { id: "auth", label: "鉴权", status: "fail", detail: "凭证无效" },
            ],
            verified_at: "2026-08-03T00:00:00Z",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const result = await verifyProviderDeep("ollama", {
      endpoint: "http://127.0.0.1:11434",
      model: "llama3",
      timeout_seconds: 30,
    });

    expect(result.status).toBe("failed");
    expect(result.current_step).toBe("auth");
    expect(result.steps[0].status).toBe("fail");
    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:43123/v1/providers/verify",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer startup-token",
        }),
        body: JSON.stringify({
          provider_type: "ollama",
          endpoint: "http://127.0.0.1:11434",
          model: "llama3",
          timeout_seconds: 30,
        }),
      }),
    );
  });

  it("throws an ApiError when the deep-verify endpoint fails", async () => {
    vi.mocked(invoke).mockResolvedValue({
      baseUrl: "http://127.0.0.1:43123",
      bearerToken: "startup-token",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: "provider_verify_failed",
            message: "验证失败",
            retryable: true,
            request_id: "req-123",
            recommended_action: "稍后重试",
          }),
          { status: 502, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    await expect(
      verifyProviderDeep("ollama", { endpoint: "http://127.0.0.1:11434" }),
    ).rejects.toMatchObject({
      name: "ApiError",
      code: "provider_verify_failed",
      retryable: true,
      requestId: "req-123",
    });
  });

  it("lists provider types through the unified API client", async () => {
    vi.mocked(invoke).mockResolvedValue({
      baseUrl: "http://127.0.0.1:43123",
      bearerToken: "startup-token",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ providers: ["ollama", "feishu"] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await expect(listProviderTypes()).resolves.toEqual(["ollama", "feishu"]);
    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:43123/v1/providers/types",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer startup-token",
        }),
      }),
    );
  });
});
