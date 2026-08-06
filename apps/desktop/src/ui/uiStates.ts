/**
 * UI-state labels, error severity and danger-confirmation rules.
 *
 * Pure helpers the UI uses to render consistent state text, pick a severity
 * for toast/banner surfaces, and decide which irreversible actions need a
 * confirmation dialog.
 */

export type StateName = "loading" | "empty" | "error" | "offline" | "degraded";

/** Chinese label for each UI state. */
export function stateLabel(state: StateName): string {
  switch (state) {
    case "loading":
      return "载入中";
    case "empty":
      return "暂无内容";
    case "error":
      return "出错";
    case "offline":
      return "离线";
    case "degraded":
      return "功能受限";
  }
}

export type Severity = "info" | "warning" | "error" | "fatal";

export interface SeveritySource {
  /** Stable machine-readable error code, e.g. "http_500" or "offline". */
  readonly code?: string;
  /** Whether the failure is unrecoverable and requires a restart. */
  readonly fatal?: boolean;
}

/**
 * Maps an error's code/fatal flag to a severity tier used to pick the
 * visual treatment and announced tone of a toast/banner.
 */
export function severityOf(error: SeveritySource): Severity {
  if (error.fatal) {
    return "fatal";
  }
  const code = (error.code ?? "").toLowerCase();
  if (code.includes("fatal") || code === "readiness_failed_closed") {
    return "fatal";
  }
  if (code.includes("offline") || code === "network") {
    return "error";
  }
  if (
    code.includes("error") ||
    code.includes("http_5") ||
    code.includes("_5xx")
  ) {
    return "error";
  }
  if (
    code.includes("warning") ||
    code.includes("degraded") ||
    code.includes("quota")
  ) {
    return "warning";
  }
  return "info";
}

export type ConfirmAction = "delete" | "reset" | "deploy" | "run" | "save";

/**
 * Whether an action irreversibly destroys state and therefore must always be
 * confirmed. Delete and reset are always destructive; the rest are safe.
 */
export function needsConfirmation(action: ConfirmAction): boolean {
  return action === "delete" || action === "reset";
}