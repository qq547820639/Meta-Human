import { afterEach, describe, expect, it, vi } from "vitest";

import {
  feishuStepsToState,
  mapDeepVerification,
  providerVerifyDetailStepLabel,
  providerVerifyLabels,
  verifyFeishu,
  verifyProvider,
  verifyProviderDetail,
} from "./providerVerify";
import type { ProviderVerification } from "./settingsClient";

function baseVerification(
  overrides: Partial<ProviderVerification>,
): ProviderVerification {
  return {
    provider_type: "ollama",
    status: "failed",
    current_step: null,
    endpoint: null,
    network_reachable: null,
    tls_status: null,
    auth_status: null,
    permission_status: null,
    api_version_compatible: null,
    model_exists: null,
    model_capabilities: [],
    first_response_latency_ms: null,
    total_duration_ms: 0,
    recoverable: null,
    recommended_action: null,
    error_trace_id: null,
    steps: [],
    verified_at: "2026-08-03T00:00:00Z",
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("providerVerify", () => {
  it("returns unconfigured when no URL is provided", async () => {
    await expect(
      verifyProvider("", vi.fn<() => Promise<boolean>>()),
    ).resolves.toBe("unconfigured");
    await expect(
      verifyProvider(undefined, vi.fn<() => Promise<boolean>>()),
    ).resolves.toBe("unconfigured");
  });

  it("maps a reachable check to verified", async () => {
    const check = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
    await expect(
      verifyProvider("http://127.0.0.1:11434", check),
    ).resolves.toBe("verified");
    expect(check).toHaveBeenCalledWith("http://127.0.0.1:11434");
  });

  it("maps an unreachable check to network_unreachable", async () => {
    const check = vi.fn<() => Promise<boolean>>().mockResolvedValue(false);
    await expect(
      verifyProvider("http://127.0.0.1:11434", check),
    ).resolves.toBe("network_unreachable");
  });

  it("maps a throwing check to network_unreachable without claiming success", async () => {
    const check = vi.fn<() => Promise<boolean>>().mockRejectedValue(
      new Error("boom"),
    );
    await expect(
      verifyProvider("http://127.0.0.1:11434", check),
    ).resolves.toBe("network_unreachable");
  });

  it("enumerates all required provider states", () => {
    expect(providerVerifyLabels).toMatchObject({
      unconfigured: "未配置",
      configured_unverified: "已配置但未验证",
      verifying: "正在验证",
      verified: "验证成功",
      network_unreachable: "网络不可达",
      invalid_credentials: "凭证无效",
      credentials_expired: "凭证过期",
      insufficient_permission: "权限不足",
      model_not_found: "模型不存在",
      space_not_found: "Space ID 不存在",
      api_version_incompatible: "API 版本不兼容",
    });
  });

  it("verifyProviderDetail reports unconfigured when no URL is given", async () => {
    const result = await verifyProviderDetail(
      "  ",
      vi.fn<() => Promise<boolean>>(),
      "remote",
    );
    expect(result.state).toBe("unconfigured");
    expect(result.providerType).toBe("remote");
    expect(result.latencyMs).toBe(0);
    expect(result.step).toBe("unconfigured");
  });

  it("verifyProviderDetail reports the url, provider type and latency on success", async () => {
    const check = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
    const result = await verifyProviderDetail(
      "http://127.0.0.1:11434",
      check,
      "local",
    );
    expect(result.state).toBe("verified");
    expect(result.url).toBe("http://127.0.0.1:11434");
    expect(result.providerType).toBe("local");
    expect(result.step).toBe("ok");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("verifyProviderDetail records the failing step and latency on failure", async () => {
    const check = vi.fn<() => Promise<boolean>>().mockResolvedValue(false);
    const result = await verifyProviderDetail(
      "http://127.0.0.1:9",
      check,
      "remote",
    );
    expect(result.state).toBe("network_unreachable");
    expect(result.url).toBe("http://127.0.0.1:9");
    expect(result.providerType).toBe("remote");
    expect(result.step).toBe("connection");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.detail).toBeTruthy();
  });

  it("verifyProviderDetailStepLabel maps the known steps", () => {
    expect(providerVerifyDetailStepLabel("ok")).toBe("全部检查通过");
    expect(providerVerifyDetailStepLabel("connection")).toBe("连接服务");
    expect(providerVerifyDetailStepLabel("unconfigured")).toBe("未配置地址");
    expect(providerVerifyDetailStepLabel("other")).toBe("other");
  });

  it("verifies Feishu steps and reports the doc list from the real source", async () => {
    const listSources = vi.fn().mockResolvedValue([
      { documentId: "doc-1", title: "T", chunkCount: 1 },
    ]);
    const steps = await verifyFeishu({
      appId: "cli_app",
      appSecretSet: true,
      accessTokenSet: true,
      spaceId: "space-1",
      listSources,
    });
    expect(steps.map((step) => step.status)).toEqual([
      "pass",
      "pass",
      "pass",
      "pass",
      "pass",
      "pass",
    ]);
    expect(listSources).toHaveBeenCalledTimes(1);
    expect(feishuStepsToState(steps)).toBe("configured_unverified");
  });

  it("flags missing Feishu config and a failed doc-list read honestly", async () => {
    const listSources = vi.fn().mockRejectedValue(new Error("network"));
    const steps = await verifyFeishu({
      appId: "",
      appSecretSet: false,
      accessTokenSet: false,
      spaceId: "",
      listSources,
    });
    expect(steps[0].status).toBe("fail");
    expect(steps[4].status).toBe("fail");
    expect(feishuStepsToState(steps)).toBe("unconfigured");
  });
});

describe("mapDeepVerification", () => {
  it("maps status ok to verified", () => {
    expect(mapDeepVerification(baseVerification({ status: "ok" }))).toBe(
      "verified",
    );
  });

  it("maps status unconfigured to unconfigured", () => {
    expect(
      mapDeepVerification(baseVerification({ status: "unconfigured" })),
    ).toBe("unconfigured");
  });

  it("maps an auth failure to invalid_credentials", () => {
    expect(
      mapDeepVerification(
        baseVerification({ auth_status: "invalid_credentials" }),
      ),
    ).toBe("invalid_credentials");
    expect(
      mapDeepVerification(baseVerification({ auth_status: "not_configured" })),
    ).toBe("invalid_credentials");
  });

  it("maps a permission failure to insufficient_permission", () => {
    expect(
      mapDeepVerification(
        baseVerification({ permission_status: "insufficient_permission" }),
      ),
    ).toBe("insufficient_permission");
  });

  it("maps a missing model to model_not_found", () => {
    expect(
      mapDeepVerification(baseVerification({ model_exists: false })),
    ).toBe("model_not_found");
  });

  it("maps an unreachable network to network_unreachable", () => {
    expect(
      mapDeepVerification(baseVerification({ network_reachable: false })),
    ).toBe("network_unreachable");
    expect(
      mapDeepVerification(baseVerification({ current_step: "connection" })),
    ).toBe("network_unreachable");
  });

  it("falls back to configured_unverified for an unresolved failed status", () => {
    expect(mapDeepVerification(baseVerification({}))).toBe(
      "configured_unverified",
    );
  });
});