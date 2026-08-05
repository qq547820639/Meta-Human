import { describe, expect, it } from "vitest";

import { buildDiagnosticReport } from "./diagnosticReport";
import type { AppDiagnostics, SettingsDiagnosticSummary } from "./diagnosticsClient";

const diagnostics: AppDiagnostics = {
  name: "voxstudio-desktop",
  version: "0.1.0",
  channel: "stable",
  commit: "abc123",
  dataDir: "/data/voxstudio",
  connection: "ready (baseUrl=http://127.0.0.1:43210)",
  sidecar: {
    active: true,
    crashed: true,
    crashRestarts: 1,
    lastExitCode: 139,
    lastError: "sidecar restart budget exhausted",
  },
};

const settings: SettingsDiagnosticSummary = {
  localBaseUrl: "http://127.0.0.1:11434",
  localChatModel: "qwen",
  localEmbeddingModel: null,
  localSttModel: null,
  remoteBaseUrl: "https://gpu.example.com",
  remoteTtsVoice: null,
  feishuAppId: null,
  feishuSpaceId: null,
  remoteApiKeySet: true,
  feishuAppSecretSet: false,
  feishuAccessTokenSet: false,
  feishuRefreshTokenSet: false,
};

describe("buildDiagnosticReport", () => {
  it("includes app, sidecar, and settings summary", () => {
    const report = buildDiagnosticReport({
      diagnostics,
      settings,
      exportedAt: "2026-08-05T00:00:00Z",
    });

    expect(report).toContain("VoxStudio 诊断报告");
    expect(report).toContain("版本: 0.1.0");
    expect(report).toContain("更新通道: stable");
    expect(report).toContain("连接: ready (baseUrl=http://127.0.0.1:43210)");
    expect(report).toContain("曾崩溃: 是");
    expect(report).toContain("最近退出码: 139");
    expect(report).toContain("本地服务地址: http://127.0.0.1:11434");
    expect(report).toContain("远程 API Key 已保存: 是");
    expect(report).toContain("本报告不包含任何密钥或令牌。");
  });

  it("never leaks secret values and marks unset fields", () => {
    const report = buildDiagnosticReport({
      diagnostics,
      settings: {
        ...settings,
        remoteBaseUrl: null,
        remoteApiKeySet: true,
      },
      exportedAt: "2026-08-05T00:00:00Z",
    });

    expect(report).not.toContain("Bearer");
    expect(report).not.toContain("bearerToken");
    expect(report).toContain("远程服务地址: (未配置)");
    expect(report).toContain("远程 API Key 已保存: 是");
  });

  it("redacts by default even when detail is supplied", () => {
    const report = buildDiagnosticReport({
      diagnostics,
      settings,
      exportedAt: "2026-08-05T00:00:00Z",
      detail: {
        recentTranscript: "user: 我的密钥是 hunter2",
        mediaPaths: ["/private/tmp/voxstudio-portrait-1.jpg", "/tmp/voxstudio-recording-1.wav"],
      },
    });

    expect(report).toContain("脱敏: 已启用");
    expect(report).not.toContain("hunter2");
    expect(report).not.toContain("voxstudio-portrait-1.jpg");
    expect(report).not.toContain("voxstudio-recording-1.wav");
    expect(report).not.toContain("最近对话文本:");
    expect(report).not.toContain("媒体文件路径:");
  });

  it("includes recent transcript and media paths only when redaction is off", () => {
    const report = buildDiagnosticReport({
      diagnostics,
      settings,
      exportedAt: "2026-08-05T00:00:00Z",
      redact: false,
      detail: {
        recentTranscript: "user: 你好\nassistant: 你好，有什么可以帮你？",
        mediaPaths: ["/private/tmp/voxstudio-portrait-1.jpg"],
      },
    });

    expect(report).toContain("脱敏: 已关闭");
    expect(report).toContain("最近对话文本:");
    expect(report).toContain("user: 你好");
    expect(report).toContain("媒体文件路径:");
    expect(report).toContain("voxstudio-portrait-1.jpg");
  });
});