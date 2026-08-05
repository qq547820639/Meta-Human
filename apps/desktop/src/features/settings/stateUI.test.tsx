import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppSettings, SecretFlags } from "./settingsClient";
import FeishuKnowledgePanel from "./FeishuKnowledgePanel";
import MemoryPanel from "./MemoryPanel";
import DiagnosticsPanel from "../diagnostics/DiagnosticsPanel";

const emptySettings: AppSettings = {
  localBaseUrl: "",
  localChatModel: "",
  localEmbeddingModel: "",
  localSttModel: "",
  localTimeoutSeconds: 5,
  remoteBaseUrl: "",
  remoteTtsVoice: "",
  remoteVoiceEnrollPath: "",
  remoteAvatarEnrollPath: "",
  remoteAvatarStreamPath: "",
  remoteAvatarStreamStopPath: "",
  remoteTtsPath: "",
  feishuAppId: "",
  feishuSpaceId: "",
  feishuBaseUrl: "",
};

const emptySecretFlags: SecretFlags = {
  remoteApiKeySet: false,
  feishuAppSecretSet: false,
  feishuAccessTokenSet: false,
  feishuRefreshTokenSet: false,
};

vi.mock("../diagnostics/diagnosticsClient", () => ({
  getAppDiagnostics: vi.fn(),
  saveDiagnosticPackage: vi.fn(),
}));

vi.mock("../diagnostics/metricsClient", () => ({
  getProviderMetrics: vi.fn(() =>
    Promise.resolve({ providers: [], total_calls: 0, total_error_rate: 0, total_cancel_rate: 0, total_degraded_rate: 0 }),
  ),
  formatProviderHealth: (row: { provider: string }) => row.provider,
}));

vi.mock("../knowledge/knowledgeClient", () => ({
  listKnowledgeSources: vi.fn(() => Promise.resolve([])),
}));

vi.mock("../memory/memoryClient", () => ({
  MEMORY_TYPES: [],
  MEMORY_SOURCES: [],
  memoryTypeLabel: (t: string) => t,
  memorySourceLabel: (s: string) => s,
  memoryScopeLabel: (s: string) => s,
  getMemoryPrivacyStatement: vi.fn(() => Promise.resolve("")),
  listMemoryEntries: vi.fn(),
  listMemoryIgnoreRules: vi.fn(() => Promise.resolve({ rules: [] })),
}));

import { getAppDiagnostics } from "../diagnostics/diagnosticsClient";
import { listMemoryEntries } from "../memory/memoryClient";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  vi.mocked(listMemoryEntries).mockResolvedValue({ entries: [], total: 0 });
});

describe("Knowledge panel state UI", () => {
  const sourcesProps = {
    settings: emptySettings,
    update: vi.fn(),
    secretFlags: emptySecretFlags,
    feishuAppSecret: "",
    setFeishuAppSecret: vi.fn(),
    feishuAccessToken: "",
    setFeishuAccessToken: vi.fn(),
    feishuRefreshToken: "",
    setFeishuRefreshToken: vi.fn(),
    onClearSecret: vi.fn(),
    confirmingSourceId: null,
    onDeleteSource: vi.fn(),
    onOpenDelete: vi.fn(),
    onCloseDelete: vi.fn(),
    onSetEnabled: vi.fn(),
    onResync: vi.fn(),
  };

  it("shows a readable loading state for knowledge sources", () => {
    render(
      <FeishuKnowledgePanel
        {...sourcesProps}
        knowledgeSources={[]}
        sourcesLoading
        sourcesError={null}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "正在读取知识来源…",
    );
  });

  it("surfaces a knowledge-source error as an alert", () => {
    render(
      <FeishuKnowledgePanel
        {...sourcesProps}
        knowledgeSources={[]}
        sourcesLoading={false}
        sourcesError="无法读取知识来源。"
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("无法读取知识来源。");
  });

  it("describes an empty knowledge list instead of a blank panel", () => {
    render(
      <FeishuKnowledgePanel
        {...sourcesProps}
        knowledgeSources={[]}
        sourcesLoading={false}
        sourcesError={null}
      />,
    );
    expect(screen.getByText("还没有同步的知识来源。")).toBeInTheDocument();
  });
});

describe("Memory panel state UI", () => {
  const panelProps = { setStatus: vi.fn(), setError: vi.fn() };

  it("shows a readable loading state for long-term memory", () => {
    vi.mocked(listMemoryEntries).mockReturnValue(new Promise(() => undefined));
    render(<MemoryPanel {...panelProps} />);
    expect(screen.getByRole("status")).toHaveTextContent("正在读取长期记忆…");
  });

  it("surfaces a memory read error as an alert", async () => {
    vi.mocked(listMemoryEntries).mockRejectedValue(new Error("boom"));
    render(<MemoryPanel {...panelProps} />);
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("无法读取长期记忆。"),
    );
  });

  it("describes an empty memory list with readable text", async () => {
    render(<MemoryPanel {...panelProps} />);
    await waitFor(() =>
      expect(screen.getByText("暂无记忆。")).toBeInTheDocument(),
    );
  });
});

describe("Diagnostics panel state UI", () => {
  it("shows a readable loading state while diagnostics are pending", () => {
    vi.mocked(getAppDiagnostics).mockReturnValue(new Promise(() => undefined));
    render(
      <DiagnosticsPanel settings={emptySettings} secretFlags={emptySecretFlags} />,
    );
    expect(screen.getByText(/应用：.*读取中…/)).toBeInTheDocument();
    expect(screen.getByText(/Sidecar 连接：读取中…/)).toBeInTheDocument();
  });

  it("surfaces a diagnostics read error as an alert", async () => {
    vi.mocked(getAppDiagnostics).mockRejectedValue(new Error("boom"));
    render(
      <DiagnosticsPanel settings={emptySettings} secretFlags={emptySecretFlags} />,
    );
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "无法读取应用诊断信息。",
      ),
    );
  });

  it("describes an empty provider-metrics list with readable text", async () => {
    vi.mocked(getAppDiagnostics).mockResolvedValue({
      name: "voxstudio-desktop",
      version: "0.1.0",
      channel: "stable",
      commit: "abc",
      dataDir: null,
      connection: "ready",
      sidecar: {
        active: true,
        crashed: false,
        crashRestarts: 0,
        lastExitCode: null,
        lastError: null,
      },
    });
    render(
      <DiagnosticsPanel settings={emptySettings} secretFlags={emptySecretFlags} />,
    );
    await waitFor(() =>
      expect(screen.getByText("暂无 provider 调用记录。")).toBeInTheDocument(),
    );
  });
});