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
import {
  getProviderMetrics,
  ProviderMetricsSummary,
  formatProviderHealth,
} from "./metricsClient";
import { listConversationHistory } from "../conversation/conversationClient";

interface DiagnosticsPanelProps {
  readonly settings: AppSettings;
  readonly secretFlags: SecretFlags;
  /** Media file paths in use (portraits/recordings); included only when the
   * user explicitly turns redaction off. Defaults to none. */
  readonly mediaPaths?: readonly string[] | null;
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
  mediaPaths = null,
}: DiagnosticsPanelProps) {
  const [diagnostics, setDiagnostics] = useState<AppDiagnostics | null>(null);
  const [metrics, setMetrics] = useState<ProviderMetricsSummary | null>(null);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  // Redaction is on by default for privacy: conversation text and media paths
  // are excluded unless the user explicitly opts out.
  const [redact, setRedact] = useState(true);

  useEffect(() => {
    let active = true;
    getAppDiagnostics()
      .then((value) => {
        if (active) setDiagnostics(value);
      })
      .catch(() => {
        if (active) setError("无法读取应用诊断信息。");
      });
    getProviderMetrics()
      .then((value) => {
        if (active) setMetrics(value);
      })
      .catch(() => {
        if (active) setMetricsError("无法读取 provider 指标。");
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
      let detail:
        | { recentTranscript: string | null; mediaPaths: readonly string[] | null }
        | undefined;
      if (!redact) {
        let recentTranscript: string | null = null;
        try {
          const history = await listConversationHistory();
          const last = history.messages.slice(-6);
          if (last.length > 0) {
            recentTranscript = last
              .map((message) => `${message.role}: ${message.content}`)
              .join("\n");
          }
        } catch {
          recentTranscript = "(无法读取对话历史)";
        }
        detail = { recentTranscript, mediaPaths: mediaPaths ?? null };
      }
      const report = buildDiagnosticReport({
        diagnostics: snapshot,
        settings: toSettingsSummary(settings, secretFlags),
        exportedAt: new Date().toISOString(),
        redact,
        detail,
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

      <div>
        <p className="studio-status-title" style={{ marginBottom: "0.25rem" }}>
          Provider 指标
        </p>
        {metrics ? (
          metrics.providers.length > 0 ? (
            <ul>
              {metrics.providers.map((row) => (
                <li key={row.provider}>{formatProviderHealth(row)}</li>
              ))}
              <li>
                总计 {metrics.total_calls} 次调用 · 错误率{" "}
                {Math.round(metrics.total_error_rate * 100)}% · 取消率{" "}
                {Math.round(metrics.total_cancel_rate * 100)}% · 降级率{" "}
                {Math.round(metrics.total_degraded_rate * 100)}%
              </li>
            </ul>
          ) : (
            <p>暂无 provider 调用记录。</p>
          )
        ) : (
          <p>{metricsError ?? "读取中…"}</p>
        )}
      </div>

      <label style={{ display: "block", margin: "0.5rem 0" }}>
        <input
          type="checkbox"
          checked={redact}
          onChange={(event) => setRedact(event.target.checked)}
        />
        导出时脱敏（不含对话文本与媒体路径）
      </label>
      <button type="button" onClick={() => void handleExport()} disabled={exporting}>
        {exporting ? "导出中…" : "导出诊断报告"}
      </button>
      <p>
        诊断报告包含应用版本、Sidecar 状态、配置摘要与 provider 指标，不包含任何密钥。
        默认脱敏；关闭脱敏后才会包含最近对话文本与媒体路径。
      </p>
      {status ? <p role="status">{status}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
    </SettingsPanel>
  );
}