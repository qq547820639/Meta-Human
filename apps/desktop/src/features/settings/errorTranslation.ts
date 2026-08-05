/**
 * Error translation for the settings wizard.
 *
 * Maps low-level technical failures (connection refused, 401/403/404/5xx,
 * timeouts, missing credentials) into plain-language next steps and the
 * one-click actions the UI can offer the user. The UI never claims success it
 * did not observe; it only maps errors that were actually detected.
 */

export type ErrorActionKind =
  | "retry"
  | "open_permissions"
  | "reauthorize"
  | "reselect_model";

export interface TranslatedError {
  /** Stable machine-readable code, e.g. "connection_refused" or "http_404". */
  readonly code: string;
  readonly title: string;
  readonly steps: readonly string[];
  readonly actions: readonly ErrorActionKind[];
}

export interface TranslationContext {
  /** Human label of the failing service, e.g. "本地服务" / "远程服务". */
  readonly serviceLabel: string;
}

export const ACTION_LABELS: Record<ErrorActionKind, string> = {
  retry: "重试",
  open_permissions: "打开权限设置",
  reauthorize: "重新授权",
  reselect_model: "重新选择模型",
};

/**
 * Classifies a thrown fetch/request error into a stable code. Plain HTTP
 * statuses are surfaced as "http_<status>" strings by the probe layer; this
 * function only inspects Error objects and network-level causes.
 */
export function classifyProbeErrorCode(raw: unknown): string {
  if (
    raw instanceof Error ||
    (typeof raw === "object" && raw !== null && "name" in raw)
  ) {
    const err = raw as { name?: string; message?: string; cause?: unknown };
    if (err.name === "AbortError" || /timeout|timed out/i.test(err.message ?? "")) {
      return "timeout";
    }
    const cause = err.cause;
    if (cause !== undefined && cause !== null) {
      const code = (cause as { code?: unknown }).code;
      if (code === "ECONNREFUSED") return "connection_refused";
      if (code === "ECONNRESET") return "connection_reset";
    }
    if (
      /fetch ?failed|failed to fetch|networkerror|network request failed|econnrefused|econnreset/i.test(
        err.message ?? "",
      )
    ) {
      return "connection_refused";
    }
    return "unknown";
  }
  return raw === "credentials_missing" ? "credential_missing" : "unknown";
}
export function translateHttpStatus(
  status: number,
  context: TranslationContext,
): TranslatedError {
  const code =
    status === 401
      ? "http_401"
      : status === 403
        ? "http_403"
        : status === 404
          ? "http_404"
          : status >= 500
            ? "http_5xx"
            : "unknown";
  return translateErrorCode(code, context);
}

export function translateServiceError(
  raw: unknown,
  context: TranslationContext,
): TranslatedError {
  if (typeof raw === "string") {
    if (raw === "unconfigured") {
      return translateErrorCode("unconfigured", context);
    }
    if (raw.startsWith("http_")) {
      const status = Number(raw.slice("http_".length));
      return translateHttpStatus(status, context);
    }
    return translateErrorCode(raw === "credentials_missing" ? "credential_missing" : raw, context);
  }
  if (
    typeof raw === "object" &&
    raw !== null &&
    "status" in raw &&
    typeof (raw as { status?: unknown }).status === "number"
  ) {
    return translateHttpStatus(
      (raw as { status: number }).status,
      context,
    );
  }
  if (
    typeof raw === "object" &&
    raw !== null &&
    "code" in raw &&
    typeof (raw as { code?: unknown }).code === "string"
  ) {
    return translateErrorCode((raw as { code: string }).code, context);
  }
  return translateErrorCode(classifyProbeErrorCode(raw), context);
}

export function translateErrorCode(
  code: string,
  context: TranslationContext,
): TranslatedError {
  const s = context.serviceLabel;
  switch (code) {
    case "unconfigured":
      return {
        code,
        title: `请先配置${s}地址`,
        steps: [`填写${s}地址后再试。`],
        actions: [],
      };
    case "connection_refused":
    case "connection_reset":
      return {
        code,
        title: `${s}当前无法连接`,
        steps: [
          "确认本地模型服务（Ollama 或 LM Studio）已经启动。",
          "确认地址和端口正确（Ollama 默认 11434，LM Studio 默认 1234）。",
          "如果服务装在其他设备上，请确认网络可以访问它。",
        ],
        actions: ["retry"],
      };
    case "timeout":
      return {
        code,
        title: `${s}响应超时`,
        steps: [
          "服务可能正在加载模型，请稍候再试。",
          "确认地址和端口正确。",
        ],
        actions: ["retry"],
      };
    case "http_401":
      return {
        code,
        title: `${s}拒绝了访问（接口密钥无效）`,
        steps: [
          "检查近期是否更换过接口密钥。",
          "重新填写并授权后再试。",
        ],
        actions: ["reauthorize", "retry"],
      };
    case "http_403":
      return {
        code,
        title: `${s}拒绝了访问（权限不足）`,
        steps: [
          "检查系统或应用的权限设置。",
          "授权后重试。",
        ],
        actions: ["open_permissions", "retry"],
      };
    case "http_404":
      return {
        code,
        title: `${s}找不到请求的接口`,
        steps: [
          "选择的模型或端点可能已失效。",
          "重新选择模型后再试。",
        ],
        actions: ["reselect_model", "retry"],
      };
    case "http_5xx":
      return {
        code,
        title: `${s}服务暂时出了点问题`,
        steps: [
          "服务可能正在重启或忙碌，请稍候。",
          "过一小段时间后重试。",
        ],
        actions: ["retry"],
      };
    case "credential_missing":
      return {
        code,
        title: `${s}缺少访问凭证`,
        steps: [
          "请先完成授权，再保存设置。",
        ],
        actions: ["reauthorize"],
      };
    case "model_not_found":
      return {
        code,
        title: "选择的模型不可用",
        steps: [
          "该模型可能尚未安装或已被移除。",
          "重新选择列表中的可用模型。",
        ],
        actions: ["reselect_model"],
      };
    default:
      return {
        code: "unknown",
        title: `${s}遇到了未知问题`,
        steps: ["请查看下方诊断信息，或稍后重试。"],
        actions: ["retry"],
      };
  }
}