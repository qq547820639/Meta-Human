import type { AppDiagnostics, SettingsDiagnosticSummary } from "./diagnosticsClient";

/**
 * Optional, non-secret operational detail that is only included when
 * redaction is disabled. Secrets are never included regardless of this toggle.
 */
export interface DiagnosticDetailInput {
  readonly recentTranscript: string | null;
  readonly mediaPaths: readonly string[] | null;
}

export interface DiagnosticReportInput {
  readonly diagnostics: AppDiagnostics;
  readonly settings: SettingsDiagnosticSummary;
  readonly exportedAt: string;
  /** Default true. When true, no conversation text or media paths are included. */
  readonly redact?: boolean;
  readonly detail?: DiagnosticDetailInput;
}

/**
 * Builds a plain-text diagnostic package. Deliberately omits any secret values;
 * only boolean "is set" flags and non-secret URLs/model names are included.
 *
 * Redaction is on by default: conversation text and media (recording/portrait)
 * paths are excluded. Turning redaction off adds operational detail (recent
 * transcript text and the media file paths that were in use) but NEVER includes
 * secrets (Keychain entries, tokens, memory, or knowledge content).
 */
export function buildDiagnosticReport({
  diagnostics,
  settings,
  exportedAt,
  redact = true,
  detail,
}: DiagnosticReportInput): string {
  const lines: string[] = [];
  lines.push("VoxStudio 诊断报告");
  lines.push("=================");
  lines.push(`导出时间: ${exportedAt}`);
  lines.push(`脱敏: ${redact ? "已启用" : "已关闭"}`);
  lines.push("");
  lines.push("-- 应用 --");
  lines.push(`名称: ${diagnostics.name}`);
  lines.push(`版本: ${diagnostics.version}`);
  lines.push(`更新通道: ${diagnostics.channel}`);
  lines.push(`构建提交: ${diagnostics.commit}`);
  lines.push(`数据目录: ${diagnostics.dataDir ?? "未知"}`);
  lines.push("");
  lines.push("-- Sidecar 状态 --");
  lines.push(`连接: ${diagnostics.connection}`);
  const sidecar = diagnostics.sidecar;
  lines.push(`运行中: ${sidecar.active ? "是" : "否"}`);
  lines.push(`曾崩溃: ${sidecar.crashed ? "是" : "否"}`);
  lines.push(`重建次数: ${sidecar.crashRestarts}`);
  if (sidecar.lastExitCode !== null) {
    lines.push(`最近退出码: ${sidecar.lastExitCode}`);
  }
  if (sidecar.lastError !== null) {
    lines.push(`最近错误: ${sidecar.lastError}`);
  }
  lines.push("");
  lines.push("-- 配置摘要（不含密钥） --");
  lines.push(`本地服务地址: ${settings.localBaseUrl ?? "(未配置)"}`);
  lines.push(`本地对话模型: ${settings.localChatModel ?? "(未配置)"}`);
  lines.push(`本地嵌入模型: ${settings.localEmbeddingModel ?? "(未配置)"}`);
  lines.push(`本地语音识别模型: ${settings.localSttModel ?? "(未配置)"}`);
  lines.push(`远程服务地址: ${settings.remoteBaseUrl ?? "(未配置)"}`);
  lines.push(`远程 TTS 音色: ${settings.remoteTtsVoice ?? "(未配置)"}`);
  lines.push(`飞书 App ID: ${settings.feishuAppId ?? "(未配置)"}`);
  lines.push(`飞书知识空间: ${settings.feishuSpaceId ?? "(未配置)"}`);
  lines.push(`远程 API Key 已保存: ${settings.remoteApiKeySet ? "是" : "否"}`);
  lines.push(`飞书 App Secret 已保存: ${settings.feishuAppSecretSet ? "是" : "否"}`);
  lines.push(`飞书 Access Token 已保存: ${settings.feishuAccessTokenSet ? "是" : "否"}`);
  lines.push(`飞书 Refresh Token 已保存: ${settings.feishuRefreshTokenSet ? "是" : "否"}`);

  if (!redact && detail) {
    lines.push("");
    lines.push("-- 会话详情（脱敏已关闭） --");
    if (detail.mediaPaths && detail.mediaPaths.length > 0) {
      lines.push("媒体文件路径:");
      for (const mediaPath of detail.mediaPaths) {
        lines.push(`  - ${mediaPath}`);
      }
    } else {
      lines.push("媒体文件路径: (无)");
    }
    if (detail.recentTranscript && detail.recentTranscript.trim()) {
      lines.push("最近对话文本:");
      for (const transcriptLine of detail.recentTranscript.split("\n")) {
        lines.push(`  ${transcriptLine}`);
      }
    } else {
      lines.push("最近对话文本: (无)");
    }
  }

  lines.push("");
  lines.push("安全说明: 本报告不包含任何密钥或令牌。");
  lines.push(
    "隐私说明: 未经您的明确同意，不会上传对话文本、录音、照片、知识、记忆或密钥。",
  );
  return `${lines.join("\n")}\n`;
}