import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Settings from "./Settings";
import {
  deleteKnowledgeSource,
  listKnowledgeSources,
} from "../knowledge/knowledgeClient";
import { clearAllLocalData } from "../privacy/privacyClient";
import { deleteCapturedTempMedia } from "../creation/captureClient";
import {
  clearMemoryEntries,
  deleteMemoryEntry,
  listMemoryEntries,
  updateMemoryEntry,
} from "../memory/memoryClient";
import {
  checkLocalProvider,
  checkRemoteProvider,
  exchangeFeishuCode,
  loadAppSettings,
  openFeishuAuthorization,
  resetAllSettings,
  restartSidecar,
  saveAppSettings,
  startFeishuOauth,
} from "./settingsClient";

vi.mock("./settingsClient", () => ({
  loadAppSettings: vi.fn(),
  saveAppSettings: vi.fn(),
  checkLocalProvider: vi.fn(),
  checkRemoteProvider: vi.fn(),
  openFeishuAuthorization: vi.fn(),
  exchangeFeishuCode: vi.fn(),
  startFeishuOauth: vi.fn(),
  restartSidecar: vi.fn(),
  resetAllSettings: vi.fn(),
}));

vi.mock("../knowledge/knowledgeClient", () => ({
  listKnowledgeSources: vi.fn(),
  deleteKnowledgeSource: vi.fn(),
}));

vi.mock("../privacy/privacyClient", () => ({
  clearAllLocalData: vi.fn(),
}));

vi.mock("../creation/captureClient", () => ({
  deleteCapturedTempMedia: vi.fn(),
}));

vi.mock("../diagnostics/diagnosticsClient", () => ({
  getAppDiagnostics: vi.fn(() =>
    Promise.resolve({
      name: "voxstudio-desktop",
      version: "0.1.0",
      channel: "stable",
      commit: "abc123",
      dataDir: "/data/voxstudio",
      connection: "ready (baseUrl=http://127.0.0.1:43210)",
      sidecar: {
        active: true,
        crashed: false,
        crashRestarts: 0,
        lastExitCode: null,
        lastError: null,
      },
    }),
  ),
  saveDiagnosticPackage: vi.fn(() => Promise.resolve("/tmp/diagnostics.txt")),
}));

vi.mock("../memory/memoryClient", () => ({
  MEMORY_TYPES: [
    "user_fact",
    "preference",
    "goal",
    "ongoing",
    "relationship",
    "habit",
    "explicit_request",
  ],
  memoryTypeLabel: (type: string) => type,
  listMemoryEntries: vi.fn(),
  updateMemoryEntry: vi.fn(),
  deleteMemoryEntry: vi.fn(),
  clearMemoryEntries: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  vi.mocked(listKnowledgeSources).mockResolvedValue([]);
  vi.mocked(clearAllLocalData).mockResolvedValue(undefined);
  vi.mocked(deleteCapturedTempMedia).mockResolvedValue(0);
  vi.mocked(listMemoryEntries).mockResolvedValue({ entries: [], total: 0 });
  vi.mocked(updateMemoryEntry).mockResolvedValue(fixtureEntry());
  vi.mocked(deleteMemoryEntry).mockResolvedValue(fixtureEntry());
  vi.mocked(clearMemoryEntries).mockResolvedValue(undefined);
  vi.mocked(resetAllSettings).mockResolvedValue(undefined);
});

function fixtureEntry(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "memory-1",
    type: "preference",
    content: "旧摘要",
    source_message_id: null,
    confidence: 0.8,
    created_at: "2026-08-04T00:00:00Z",
    updated_at: "2026-08-04T00:00:00Z",
    last_used_at: null,
    confirmed_by_user: true,
    sensitive: false,
    expires_at: null,
    conflict_group: null,
    ...overrides,
  };
}

describe("Settings", () => {
  it("loads and saves local, remote, and Feishu settings", async () => {
    vi.mocked(loadAppSettings).mockResolvedValue({
      settings: {
        localBaseUrl: "http://127.0.0.1:11434",
        feishuSpaceId: "space-1",
      },
      remoteApiKeySet: true,
      feishuAppSecretSet: false,
      feishuAccessTokenSet: false,
      feishuRefreshTokenSet: false,
    });
    vi.mocked(saveAppSettings).mockResolvedValue(undefined);
    vi.mocked(restartSidecar).mockResolvedValue(undefined);
    const onSettingsApplied = vi.fn();

    render(<Settings onSettingsApplied={onSettingsApplied} />);

    await waitFor(() =>
      expect(screen.getByLabelText("本地服务地址")).toHaveValue(
        "http://127.0.0.1:11434",
      ),
    );
    fireEvent.change(screen.getByLabelText("API Key"), {
      target: { value: "new-key" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存设置" }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "设置已保存，正在重新确认准备状态。",
      ),
    );
    expect(saveAppSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        localBaseUrl: "http://127.0.0.1:11434",
        feishuSpaceId: "space-1",
      }),
      expect.objectContaining({ remoteApiKey: "new-key" }),
    );
    expect(restartSidecar).toHaveBeenCalledTimes(1);
    expect(onSettingsApplied).toHaveBeenCalledTimes(1);
  });

  it("tests the local provider address", async () => {
    vi.mocked(loadAppSettings).mockResolvedValue({
      settings: { localBaseUrl: "http://127.0.0.1:11434" },
      remoteApiKeySet: false,
      feishuAppSecretSet: false,
      feishuAccessTokenSet: false,
      feishuRefreshTokenSet: false,
    });
    vi.mocked(checkLocalProvider).mockResolvedValue(true);

    render(<Settings />);
    await waitFor(() =>
      expect(screen.getByLabelText("本地服务地址")).toHaveValue(
        "http://127.0.0.1:11434",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "测试本地连接" }));

    await waitFor(() =>
      expect(
        screen.getByText("本地服务连接正常（验证成功）。"),
      ).toBeInTheDocument(),
    );
    expect(checkLocalProvider).toHaveBeenCalledWith(
      "http://127.0.0.1:11434",
    );
  });

  it("tests the remote provider address", async () => {
    vi.mocked(loadAppSettings).mockResolvedValue({
      settings: { remoteBaseUrl: "https://gpu.example.com" },
      remoteApiKeySet: false,
      feishuAppSecretSet: false,
      feishuAccessTokenSet: false,
      feishuRefreshTokenSet: false,
    });
    vi.mocked(checkRemoteProvider).mockResolvedValue(true);

    render(<Settings />);
    await waitFor(() =>
      expect(screen.getByLabelText("服务地址")).toHaveValue(
        "https://gpu.example.com",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "测试远程连接" }));

    await waitFor(() =>
      expect(
        screen.getByText("远程服务连接正常（验证成功）。"),
      ).toBeInTheDocument(),
    );
    expect(checkRemoteProvider).toHaveBeenCalledWith(
      "https://gpu.example.com",
    );
  });

  it("summarizes local, remote, and Feishu connection state", async () => {
    vi.mocked(loadAppSettings).mockResolvedValue({
      settings: {
        localBaseUrl: "http://127.0.0.1:11434",
        remoteBaseUrl: "https://gpu.example.com",
        feishuAppId: "cli_app",
        feishuSpaceId: "space-1",
      },
      remoteApiKeySet: false,
      feishuAppSecretSet: false,
      feishuAccessTokenSet: true,
      feishuRefreshTokenSet: false,
    });
    vi.mocked(checkLocalProvider).mockResolvedValue(true);
    vi.mocked(checkRemoteProvider).mockResolvedValue(true);

    render(<Settings />);
    await waitFor(() =>
      expect(screen.getByLabelText("本地服务地址")).toHaveValue(
        "http://127.0.0.1:11434",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "一键检查连接" }));

    await waitFor(() =>
      expect(screen.getByText("本地模型：可连接")).toBeInTheDocument(),
    );
    expect(screen.getByText("远程 GPU：可连接")).toBeInTheDocument();
    expect(screen.getByText("飞书知识：已配置")).toBeInTheDocument();
    expect(checkLocalProvider).toHaveBeenCalledWith(
      "http://127.0.0.1:11434",
    );
    expect(checkRemoteProvider).toHaveBeenCalledWith(
      "https://gpu.example.com",
    );
  });

  it("opens Feishu authorization and exchanges the code", async () => {
    vi.mocked(loadAppSettings).mockResolvedValue({
      settings: { feishuAppId: "cli_app" },
      remoteApiKeySet: false,
      feishuAppSecretSet: false,
      feishuAccessTokenSet: false,
      feishuRefreshTokenSet: false,
    });
    vi.mocked(openFeishuAuthorization).mockResolvedValue(
      "https://open.feishu.cn/authorize",
    );
    vi.mocked(exchangeFeishuCode).mockResolvedValue({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresAt: "2026-08-03T00:00:00Z",
    });

    render(<Settings />);
    await waitFor(() =>
      expect(screen.getByLabelText("应用 App ID")).toHaveValue("cli_app"),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "打开飞书授权页面" }),
    );
    await waitFor(() =>
      expect(screen.getByText("已在浏览器打开飞书授权页面。")).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByLabelText("应用 App Secret"), {
      target: { value: "secret" },
    });
    fireEvent.change(screen.getByLabelText("授权码"), {
      target: { value: "code-1" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "用授权码获取 Token" }),
    );

    await waitFor(() =>
      expect(
        screen.getByText("Access Token 已获取，保存设置后生效。"),
      ).toBeInTheDocument(),
    );
    expect(exchangeFeishuCode).toHaveBeenCalledWith(
      "code-1",
      "cli_app",
      "secret",
      "http://127.0.0.1:1420/oauth/feishu",
    );
  });

  it("starts browser-based Feishu authorization", async () => {
    vi.mocked(loadAppSettings).mockResolvedValue({
      settings: { feishuAppId: "cli_app" },
      remoteApiKeySet: false,
      feishuAppSecretSet: false,
      feishuAccessTokenSet: false,
      feishuRefreshTokenSet: false,
    });
    vi.mocked(startFeishuOauth).mockResolvedValue("code-1");
    vi.mocked(exchangeFeishuCode).mockResolvedValue({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresAt: "2026-08-03T00:00:00Z",
    });

    render(<Settings />);
    await waitFor(() =>
      expect(screen.getByLabelText("应用 App ID")).toHaveValue("cli_app"),
    );
    fireEvent.change(screen.getByLabelText("应用 App Secret"), {
      target: { value: "secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "授权飞书" }));

    await waitFor(() =>
      expect(
        screen.getByText("飞书授权完成，Access Token 已获取，保存设置后生效。"),
      ).toBeInTheDocument(),
    );
    expect(startFeishuOauth).toHaveBeenCalledWith("cli_app");
    expect(exchangeFeishuCode).toHaveBeenCalledWith(
      "code-1",
      "cli_app",
      "secret",
      "http://127.0.0.1:1420/oauth/feishu",
    );
  });

  it("clears a saved API key explicitly", async () => {
    vi.mocked(loadAppSettings).mockResolvedValue({
      settings: {},
      remoteApiKeySet: true,
      feishuAppSecretSet: true,
      feishuAccessTokenSet: true,
      feishuRefreshTokenSet: true,
    });
    vi.mocked(saveAppSettings).mockResolvedValue(undefined);
    vi.mocked(restartSidecar).mockResolvedValue(undefined);

    render(<Settings />);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "清除已保存的 API Key" }),
      ).toBeInTheDocument(),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "清除已保存的 API Key" }),
    );

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "已清除已保存的密钥，正在重新确认准备状态。",
      ),
    );
    expect(saveAppSettings).toHaveBeenCalledWith(
      expect.objectContaining({ remoteBaseUrl: "" }),
      {
        remoteApiKey: "",
        feishuAppSecret: undefined,
        feishuAccessToken: undefined,
        feishuRefreshToken: undefined,
      },
    );
    expect(restartSidecar).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "清除已保存的 API Key" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("lists and deletes knowledge sources", async () => {
    vi.mocked(loadAppSettings).mockResolvedValue({
      settings: {},
      remoteApiKeySet: false,
      feishuAppSecretSet: false,
      feishuAccessTokenSet: false,
      feishuRefreshTokenSet: false,
    });
    vi.mocked(listKnowledgeSources).mockResolvedValue([
      {
        documentId: "doc-1",
        title: "项目验收手册",
        sourceUrl: "https://feishu.cn/docx/doc-1",
        syncedAt: "2026-08-03T00:00:00Z",
        chunkCount: 3,
      },
    ]);
    vi.mocked(deleteKnowledgeSource).mockResolvedValue(undefined);

    render(<Settings />);

    await waitFor(() =>
      expect(screen.getByText("项目验收手册 · 3 段")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    await waitFor(() =>
      expect(
        screen.getByRole("dialog", { name: "删除知识来源" }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "确认删除" }),
    );

    await waitFor(() =>
      expect(screen.getByText("还没有同步的知识来源。")).toBeInTheDocument(),
    );
    expect(deleteKnowledgeSource).toHaveBeenCalledWith("doc-1");
  });

  it("clears all local data after confirmation", async () => {
    vi.mocked(loadAppSettings).mockResolvedValue({
      settings: {},
      remoteApiKeySet: false,
      feishuAppSecretSet: false,
      feishuAccessTokenSet: false,
      feishuRefreshTokenSet: false,
    });

    render(<Settings />);

    fireEvent.click(screen.getByRole("button", { name: "清空本地数据" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "清空" }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "清空" }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "已清空对话、记忆和知识来源。",
      ),
    );
    expect(clearAllLocalData).toHaveBeenCalledTimes(1);
    expect(deleteCapturedTempMedia).toHaveBeenCalledTimes(1);
  });

  it("reads, edits, confirms, and clears structured long-term memory", async () => {
    vi.mocked(loadAppSettings).mockResolvedValue({
      settings: {},
      remoteApiKeySet: false,
      feishuAppSecretSet: false,
      feishuAccessTokenSet: false,
      feishuRefreshTokenSet: false,
    });
    const entry = fixtureEntry({ content: "旧摘要", confirmed_by_user: false });
    vi.mocked(listMemoryEntries).mockResolvedValue({
      entries: [entry],
      total: 1,
    });

    render(<Settings />);

    await waitFor(() =>
      expect(screen.getByText("旧摘要")).toBeInTheDocument(),
    );

    // Edit the entry content.
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    await waitFor(() =>
      expect(screen.getByLabelText("内容")).toBeInTheDocument(),
    );
    fireEvent.change(screen.getByLabelText("内容"), {
      target: { value: "新摘要" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(updateMemoryEntry).toHaveBeenCalledWith("memory-1", {
        content: "新摘要",
      }),
    );

    // Confirm the entry.
    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    await waitFor(() =>
      expect(updateMemoryEntry).toHaveBeenCalledWith("memory-1", {
        confirmed: true,
      }),
    );

    // Delete the entry after confirmation.
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "确认删除？" }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "确认删除？" }));
    await waitFor(() =>
      expect(deleteMemoryEntry).toHaveBeenCalledWith("memory-1"),
    );

    // Clear all memory.
    fireEvent.click(screen.getByRole("button", { name: "清空记忆" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "确认清空记忆？" }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "确认清空记忆？" }));
    await waitFor(() => expect(clearMemoryEntries).toHaveBeenCalledTimes(1));
  });

  it("resets all settings after confirmation", async () => {
    vi.mocked(loadAppSettings).mockResolvedValue({
      settings: { localBaseUrl: "http://127.0.0.1:11434" },
      remoteApiKeySet: true,
      feishuAppSecretSet: false,
      feishuAccessTokenSet: false,
      feishuRefreshTokenSet: false,
    });

    render(<Settings />);

    await waitFor(() =>
      expect(screen.getByLabelText("本地服务地址")).toHaveValue(
        "http://127.0.0.1:11434",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "重置全部设置" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "重置" }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "重置" }));

    await waitFor(() =>
      expect(resetAllSettings).toHaveBeenCalledTimes(1),
    );
    expect(restartSidecar).toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByLabelText("本地服务地址")).toHaveValue(""),
    );
  });

  it("distinguishes an unconfigured local provider from a reachable one", async () => {
    vi.mocked(loadAppSettings).mockResolvedValue({
      settings: { localBaseUrl: "   " },
      remoteApiKeySet: false,
      feishuAppSecretSet: false,
      feishuAccessTokenSet: false,
      feishuRefreshTokenSet: false,
    });
    vi.mocked(checkLocalProvider).mockResolvedValue(true);

    render(<Settings />);
    await waitFor(() =>
      expect(screen.getByLabelText("本地服务地址")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "测试本地连接" }));

    await waitFor(() =>
      expect(screen.getByText("请先填写本地服务地址。")).toBeInTheDocument(),
    );
    expect(checkLocalProvider).not.toHaveBeenCalled();
  });

  it("reports network unreachable when the local provider check fails", async () => {
    vi.mocked(loadAppSettings).mockResolvedValue({
      settings: { localBaseUrl: "http://127.0.0.1:11434" },
      remoteApiKeySet: false,
      feishuAppSecretSet: false,
      feishuAccessTokenSet: false,
      feishuRefreshTokenSet: false,
    });
    vi.mocked(checkLocalProvider).mockResolvedValue(false);

    render(<Settings />);
    await waitFor(() =>
      expect(screen.getByLabelText("本地服务地址")).toHaveValue(
        "http://127.0.0.1:11434",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "测试本地连接" }));

    await waitFor(() =>
      expect(screen.getByText("本地服务网络不可达。")).toBeInTheDocument(),
    );
  });

  it("verifies Feishu step by step using real config and document list", async () => {
    vi.mocked(loadAppSettings).mockResolvedValue({
      settings: { feishuAppId: "cli_app", feishuSpaceId: "space-1" },
      remoteApiKeySet: false,
      feishuAppSecretSet: true,
      feishuAccessTokenSet: true,
      feishuRefreshTokenSet: false,
    });
    vi.mocked(listKnowledgeSources).mockResolvedValue([
      {
        documentId: "doc-1",
        title: "项目验收手册",
        sourceUrl: "https://feishu.cn/docx/doc-1",
        syncedAt: "2026-08-03T00:00:00Z",
        chunkCount: 3,
      },
    ]);

    render(<Settings />);
    await waitFor(() =>
      expect(screen.getByLabelText("应用 App ID")).toHaveValue("cli_app"),
    );
    fireEvent.click(screen.getByRole("button", { name: "验证飞书配置" }));

    await waitFor(() =>
      expect(
        screen.getByText("飞书总状态：已配置但未验证"),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText("已读取到 1 份文档。")).toBeInTheDocument();
    expect(listKnowledgeSources).toHaveBeenCalled();
  });

  it("hides advanced settings by default", async () => {
    vi.mocked(loadAppSettings).mockResolvedValue({
      settings: {},
      remoteApiKeySet: false,
      feishuAppSecretSet: false,
      feishuAccessTokenSet: false,
      feishuRefreshTokenSet: false,
    });

    render(<Settings />);
    await waitFor(() =>
      expect(screen.getByText("高级设置")).toBeInTheDocument(),
    );
    const advanced = screen.getByLabelText("高级设置");
    expect(advanced).not.toHaveAttribute("open");
  });

  it("shows a dirty indicator for unsaved changes and clears it after saving", async () => {
    vi.mocked(loadAppSettings).mockResolvedValue({
      settings: { localBaseUrl: "http://127.0.0.1:11434" },
      remoteApiKeySet: false,
      feishuAppSecretSet: false,
      feishuAccessTokenSet: false,
      feishuRefreshTokenSet: false,
    });
    vi.mocked(saveAppSettings).mockResolvedValue(undefined);
    vi.mocked(restartSidecar).mockResolvedValue(undefined);

    render(<Settings />);
    await waitFor(() =>
      expect(screen.getByLabelText("本地服务地址")).toHaveValue(
        "http://127.0.0.1:11434",
      ),
    );
    expect(screen.queryByText("有未保存的改动。")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("本地服务地址"), {
      target: { value: "http://127.0.0.1:11435" },
    });

    await waitFor(() =>
      expect(screen.getByText("有未保存的改动。")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "保存设置（未保存改动）" }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "设置已保存，正在重新确认准备状态。",
      ),
    );
    expect(
      screen.queryByText("有未保存的改动。"),
    ).not.toBeInTheDocument();
  });
});
