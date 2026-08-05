import { useEffect, useState } from "react";

import SettingsPanel from "../settings/SettingsPanel";
import type { AppSettings, SecretFlags } from "../settings/settingsClient";
import {
  AppDiagnostics,
  getAppDiagnostics,
  saveDiagnosticPackage,
  SettingsDiagnosticSummary,
} from "./diagnosticsClient";
import { buildDiagnosticReport } from "./diagnosticReport";

interface DiagnosticsPanelProps {
  readonly settings: AppSettings;
  readonly secretFlags: SecretFlags;
}

function toSettingsSummary(
  settings: AppSettings,
  secretFlags: SecretFlags,
): SettingsDiagnosticSummary {
  return {
    localBaseUrl: settings.localBaseUrl && settings.localBaseUrl.trim() ? settings.localBaseUrl : null,
    localChatModel: settings.localChatModel && settings.localChatModel.trim() ? settings.localChatModel : null,
    localEmbeddingModel: settings.localEmbeddingModel && settings.localEmbeddingModel.trim() ? settings.localEmbeddingModel : null,
    localSttModel: settings.localSttModel && settings.localSttModel.trim() ? settings.localSttModel : null,
    remoteBaseUrl: settings.remoteBaseUrl && settings.remoteBaseUrl.trim() ? settings.remoteBaseUrl : null,
    remoteTtsVoice: settings.remoteTtsVoice && settings.remoteTtsVoice.trim() ? settings.remoteTtsVoice : null,
    feishuAppId: settings.feishuAppId && settings.feishuAppId.trim() ? settings.feishuAppId : null,
    feishuSpaceId: settings.feishuSpaceId && settings.feishuSpaceId.trim() ? settings.feishuSpaceId : null,
    remoteApiKeySet: secretFlags.remoteApiKeySet,
    feishuAppSecretSet: secretFlags.feishuAppSecretSet,
    feishuAccessTokenSet: secretFlags.feishuAccessTokenSet,
    feishuRefreshTokenSet: secretFlags.feishuRefreshTokenSet,
  };
}

export default function DiagnosticsPanel({
  settings,
  secretFlags,
}: DiagnosticsPanelProps) {
  const [diagnostics, setDiagnostics] = useState<AppDiagnostics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let active = true;
    getAppDiagnostics()
      .then((value) => {
        if (active) setDiagnostics(value);
      })
      .catch(() => {
        if (active) setError("无法读取应用诊断信息。");
      });
    return () => {
      active = false;
    };
  }, []);

  const sidecar = diagnostics?.sidecar;

  async function handleExport() {
    setError(null);
    setStatus(null);
    setExporting(true);
    try {
      const snapshot = diagnostics ?? (await getAppDiagnostics());
      const report = buildDiagnosticReport({
        diagnostics: snapshot,
        settings: toSettingsSummary(settings, secretFlags),
        exportedAt: new Date().toISOString(),
      });
      const saved = await saveDiagnosticPackage(
        `voxstudio-diagnostics-${snapshot.version}.txt`,
        report,
      );
      setStatus(`诊断报告已导出到 ${saved}`);
    } catch {
      setError("导出诊断报告失败，请重试。");
    } finally {
      setExporting(false);
    }
  }

  return (
    <SettingsPanel title="诊断">
      <p>
        应用：{diagnostics ? `${diagnostics.name} ${diagnostics.version}` : "读取中…"}
        {diagnostics ? `（通道 ${diagnostics.channel}，提交 ${diagnostics.commit}）` : null}
      </p>
      <p>Sidecar 连接：{diagnostics ? diagnostics.connection : "读取中…"}</p>
      {sidecar ? (
        <p>
          Sidecar 运行：{sidecar.active ? "是" : "否"}
          {sidecar.crashed ? "（本会话曾崩溃）" : ""}
          {sidecar.crashRestarts > 0 ? `，自动重建 ${sidecar.crashRestarts} 次` : ""}
          {sidecar.lastExitCode !== null ? `，最近退出码 ${sidecar.lastExitCode}` : ""}
          {sidecar.lastError ? `，${sidecar.lastError}` : ""}
        </p>
      ) : null}
      <button type="button" onClick={() => void handleExport()} disabled={exporting}>
        {exporting ? "导出中…" : "导出诊断报告"}
      </button>
      <p>诊断报告包含应用版本、Sidecar 状态与配置摘要，不包含任何密钥。</p>
      {status ? <p role="status">{status}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
    </SettingsPanel>
  );
}