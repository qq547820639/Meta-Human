/**
 * Onboarding failure classification.
 *
 * Pure, jsdom-safe. Maps a stable failure kind to human-readable (Chinese)
 * guidance: what was detected, why it happened, what the impact is, an optional
 * one-click fix, and a severity level. Unknown kinds fall back to a generic
 * entry so the UI always has something meaningful to render.
 */

export type FailureKind =
  | "port-in-use"
  | "model-not-running"
  | "bad-credentials"
  | "permission-denied-mic"
  | "permission-denied-camera"
  | "disk-low"
  | "no-network"
  | "unknown";

export type FailureLevel = "error" | "warning";

export interface FailureGuidance {
  readonly kind: FailureKind;
  readonly detection: string;
  readonly reason: string;
  readonly impact: string;
  /** Human-readable one-click fix; empty string means no fix is available. */
  readonly oneClickFix: string;
  readonly level: FailureLevel;
}

const GUIDANCE: Record<FailureKind, Omit<FailureGuidance, "kind">> = {
  "port-in-use": {
    detection: "检测到本地服务端口（如 11434）已被其他程序占用。",
    reason: "另一个应用正在使用该端口，本地模型服务无法启动。",
    impact: "本地对话与嵌入能力不可用，数字人无法在本机运行。",
    oneClickFix: "释放占用端口后重新启动本地服务。",
    level: "error",
  },
  "model-not-running": {
    detection: "本地服务已连接，但未检测到可用的对话模型。",
    reason: "模型未下载或尚未在本地服务中加载。",
    impact: "对话与知识检索无法工作，只能使用未配置的功能。",
    oneClickFix: "下载并启动推荐模型（llama3 与 nomic-embed-text）。",
    level: "error",
  },
  "bad-credentials": {
    detection: "远程服务的鉴权信息错误或已过期。",
    reason: "API 密钥或访问令牌无效，远程请求被拒绝。",
    impact: "云端语音与形象能力不可用。",
    oneClickFix: "重新填写远程服务的密钥。",
    level: "error",
  },
  "permission-denied-mic": {
    detection: "没有获得麦克风使用权限。",
    reason: "系统或浏览器拒绝了麦克风授权。",
    impact: "无法录入你的声音，也不能用语音与数字人对话。",
    oneClickFix: "在系统设置中允许麦克风后重试。",
    level: "warning",
  },
  "permission-denied-camera": {
    detection: "没有获得摄像头使用权限。",
    reason: "系统或浏览器拒绝了摄像头授权。",
    impact: "无法拍摄数字人形象。",
    oneClickFix: "在系统设置中允许摄像头后重试。",
    level: "warning",
  },
  "disk-low": {
    detection: "磁盘可用空间不足 10 GB。",
    reason: "可用空间过少，无法下载和运行本地模型。",
    impact: "本地模型无法安装，建议改用云端配置。",
    oneClickFix: "清理磁盘空间或切换到云端增强模式。",
    level: "warning",
  },
  "no-network": {
    detection: "检测不到有效的网络连接。",
    reason: "网络不可用，远程服务无法访问。",
    impact: "云端能力不可用，只能尝试本地运行。",
    oneClickFix: "检查网络连接后重试。",
    level: "error",
  },
  unknown: {
    detection: "发生了无法识别的错误。",
    reason: "缺少足够信息来定位具体原因。",
    impact: "当前步骤可能无法完成，但不影响其他步骤。",
    oneClickFix: "",
    level: "warning",
  },
};

/** Classify a failure kind into human-readable guidance. */
export function classifyFailure(kind: FailureKind): FailureGuidance {
  const base = GUIDANCE[kind];
  if (!base) {
    return { kind: "unknown", ...GUIDANCE.unknown };
  }
  return { kind, ...base };
}

/** Whether a fix is available for the given guidance. */
export function needsOneClickFix(guidance: FailureGuidance): boolean {
  return guidance.oneClickFix.trim().length > 0;
}