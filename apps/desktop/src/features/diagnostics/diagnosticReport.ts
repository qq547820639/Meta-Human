import type { AppDiagnostics, SettingsDiagnosticSummary } from "./diagnosticsClient";

export interface DiagnosticReportInput {
  readonly diagnostics: AppDiagnostics;
  readonly settings: SettingsDiagnosticSummary;
  readonly exportedAt: string;
}

/**
 * Builds a plain-text diagnostic package. Deliberately omits any secret values;
 * only boolean "is set" flags and non-secret URLs/model names are included.
 */
export function buildDiagnosticReport({
  diagnostics,
  settings,
  exportedAt,
}: DiagnosticReportInput): string {
  const lines: string[] = [];
  lines.push("VoxStudio 诊断报告");
  lines.push("=================");
  lines.push(`导出时间: ${exportedAt}`);
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
  lines.push("");
  lines.push("安全说明: 本报告不包含任何密钥或令牌。");
  return `${lines.join("\n")}\n`;
}