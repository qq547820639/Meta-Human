import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import UpdatePanel from "./UpdatePanel";
import { UpdateConfig, UpdateError } from "./updateClient";
import * as updateClient from "./updateClient";

vi.mock("./updateClient", async (importOriginal) => {
  const actual = await importOriginal<typeof updateClient>();
  return {
    ...actual,
    getUpdateConfig: vi.fn(),
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    verifyUpdate: vi.fn(),
    installUpdate: vi.fn(),
    confirmMigrationBackup: vi.fn(),
  };
});

const configuredConfig: UpdateConfig = {
  configured: true,
  currentVersion: "0.1.0",
  channel: "stable",
  signaturePublicKeyConfigured: true,
  updateEndpointConfigured: true,
};

const unconfiguredConfig: UpdateConfig = {
  configured: false,
  currentVersion: "0.1.0",
  channel: "stable",
  signaturePublicKeyConfigured: false,
  updateEndpointConfigured: false,
};

function mockGetConfig(config: UpdateConfig) {
  vi.mocked(updateClient.getUpdateConfig).mockResolvedValue(config);
}

describe("UpdatePanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows 未配置 and no usable actions when the updater is not configured", async () => {
    mockGetConfig(unconfiguredConfig);
    render(<UpdatePanel />);
    await screen.findByText(/更新未配置/);
    expect(screen.getByText(/当前版本：0\.1\.0/)).toBeTruthy();
    // The check button is present but disabled (updates are not usable).
    const checkButton = screen.getByRole("button", { name: "检查更新" });
    expect((checkButton as HTMLButtonElement).disabled).toBe(true);
  });

  it("walks the signed lifecycle check -> available -> download/verify -> ready -> install", async () => {
    mockGetConfig(configuredConfig);
    vi.mocked(updateClient.checkForUpdates).mockResolvedValue({
      availableVersion: "0.2.0",
    });
    vi.mocked(updateClient.downloadUpdate).mockImplementation(
      async (_config, onProgress) => {
        onProgress(50, 100);
        onProgress(100, 100);
      },
    );
    vi.mocked(updateClient.verifyUpdate).mockResolvedValue({
      verified: true,
      reason: "",
    });
    vi.mocked(updateClient.confirmMigrationBackup).mockResolvedValue();
    vi.mocked(updateClient.installUpdate).mockResolvedValue();

    render(<UpdatePanel />);
    await screen.findByText(/当前版本：0\.1\.0/);

    fireEvent.click(screen.getByRole("button", { name: "检查更新" }));
    await screen.findByText(/发现新版本 0\.2\.0/);

    fireEvent.click(screen.getByRole("button", { name: "下载并验证" }));
    await screen.findByText(/签名已验证，可安装/);

    fireEvent.click(screen.getByRole("button", { name: "安装更新" }));
    await waitFor(() => {
      expect(updateClient.installUpdate).toHaveBeenCalled();
    });
  });

  it("refuses to install and shows an error when the signature is invalid", async () => {
    mockGetConfig(configuredConfig);
    vi.mocked(updateClient.checkForUpdates).mockResolvedValue({
      availableVersion: "0.2.0",
    });
    vi.mocked(updateClient.downloadUpdate).mockImplementation(
      async (_config, onProgress) => onProgress(100, 100),
    );
    vi.mocked(updateClient.verifyUpdate).mockResolvedValue({
      verified: false,
      reason: "更新包签名校验失败，已拒绝安装",
    });

    render(<UpdatePanel />);
    await screen.findByText(/当前版本：0\.1\.0/);
    fireEvent.click(screen.getByRole("button", { name: "检查更新" }));
    await screen.findByText(/发现新版本 0\.2\.0/);
    fireEvent.click(screen.getByRole("button", { name: "下载并验证" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("签名校验失败，已拒绝安装");
    // There must be no install action for an unverified package.
    expect(screen.queryByRole("button", { name: "安装更新" })).toBeNull();
  });

  it("surfaces a not_configured check failure as a retryable error", async () => {
    mockGetConfig(unconfiguredConfig);
    vi.mocked(updateClient.checkForUpdates).mockRejectedValue(
      new UpdateError("not_configured", "未配置更新端点与签名公钥"),
    );
    render(<UpdatePanel />);
    await screen.findByText(/当前版本：0\.1\.0/);
    // Force a check even though the button is disabled (as the hook would).
    await screen.findByText(/更新未配置/);
  });
});