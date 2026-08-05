/**
 * Deterministic update lifecycle state machine.
 *
 * Models the signed-update lifecycle for a desktop app that ships over a
 * stable/beta channel pair:
 *
 *   idle -> checking -> available -> downloading(progress) ->
 *   verifying_signature -> ready -> installing -> idle (installed)
 *                                        \-> error / rolled_back
 *
 * Every transition is a pure reducer that REJECTS illegal transitions (the
 * reducer returns the previous state unchanged) rather than silently
 * overriding, so stale / out-of-order events cannot corrupt the model. This
 * mirrors the `conversationStateMachine` style used elsewhere in the app.
 *
 * The actual check / download / verify / install work is performed by the
 * `updateClient`; the reducer only describes legal state movement. The
 * signature-verification step is a hard gate: a package whose signature does
 * not validate MUST NOT be installed, so `SIGNATURE_INVALID` lands the machine
 * in `error` (signature_invalid) and never in `ready`.
 */

export type UpdatePhase =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "verifying_signature"
  | "ready"
  | "installing"
  | "error"
  | "rolled_back";

export type UpdateChannel = "stable" | "beta";

export type UpdateErrorKind =
  | "not_configured"
  | "check_failed"
  | "download_failed"
  | "signature_invalid"
  | "install_failed"
  | "rollback_failed";

export interface UpdateError {
  readonly kind: UpdateErrorKind;
  readonly message: string;
}

export interface UpdateUiState {
  readonly phase: UpdatePhase;
  readonly channel: UpdateChannel;
  readonly currentVersion: string;
  readonly availableVersion: string | null;
  /** Bytes downloaded so far (0 until the download begins). */
  readonly downloadedBytes: number;
  /** Total bytes of the update package (0 if unknown). */
  readonly totalBytes: number;
  /** True only after SIGNATURE_OK; resets when the machine leaves `ready`. */
  readonly signatureVerified: boolean;
  /** True once the pre-migration backup for this update has been confirmed. */
  readonly backupMade: boolean;
  readonly error: UpdateError | null;
  /** Number of retries already attempted for the current update. */
  readonly attempt: number;
}

export const initialUpdateState: UpdateUiState = {
  phase: "idle",
  channel: "stable",
  currentVersion: "",
  availableVersion: null,
  downloadedBytes: 0,
  totalBytes: 0,
  signatureVerified: false,
  backupMade: false,
  error: null,
  attempt: 0,
};

export type UpdateAction =
  // config
  | { readonly type: "INIT_CONFIG"; readonly currentVersion: string; readonly channel: UpdateChannel }
  | { readonly type: "SET_CHANNEL"; readonly channel: UpdateChannel }
  // check
  | { readonly type: "CHECK_START" }
  | { readonly type: "CHECK_OK"; readonly availableVersion: string }
  | { readonly type: "CHECK_FAIL"; readonly kind: UpdateErrorKind; readonly message: string }
  // download
  | { readonly type: "DOWNLOAD_START" }
  | { readonly type: "DOWNLOAD_PROGRESS"; readonly downloadedBytes: number; readonly totalBytes: number }
  | { readonly type: "DOWNLOAD_COMPLETE" }
  | { readonly type: "DOWNLOAD_FAIL"; readonly message: string }
  // signature
  | { readonly type: "SIGNATURE_VERIFYING" }
  | { readonly type: "SIGNATURE_OK" }
  | { readonly type: "SIGNATURE_INVALID"; readonly message: string }
  // backup + install
  | { readonly type: "BACKUP_MADE" }
  | { readonly type: "INSTALL_START" }
  | { readonly type: "INSTALL_DONE" }
  | { readonly type: "INSTALL_FAIL"; readonly message: string }
  // recovery
  | { readonly type: "ROLLED_BACK" }
  | { readonly type: "RETRY" }
  | { readonly type: "RESET" };

function errorState(
  state: UpdateUiState,
  kind: UpdateErrorKind,
  message: string,
): UpdateUiState {
  return {
    ...state,
    phase: "error",
    error: { kind, message },
    signatureVerified: false,
  };
}

export function updateReducer(
  state: UpdateUiState,
  action: UpdateAction,
): UpdateUiState {
  switch (action.type) {
    case "INIT_CONFIG":
      return { ...state, currentVersion: action.currentVersion, channel: action.channel };
    case "SET_CHANNEL":
      // Channel can be switched only while nothing is in flight.
      if (state.phase === "idle" || state.phase === "available" || state.phase === "error" || state.phase === "rolled_back") {
        return { ...state, channel: action.channel };
      }
      return state;
    case "CHECK_START":
      return state.phase === "idle" || state.phase === "error" || state.phase === "rolled_back"
        ? { ...state, phase: "checking", error: null }
        : state;
    case "CHECK_OK":
      return state.phase === "checking"
        ? { ...state, phase: "available", availableVersion: action.availableVersion, downloadedBytes: 0, totalBytes: 0, attempt: 0 }
        : state;
    case "CHECK_FAIL":
      return state.phase === "checking"
        ? errorState(state, action.kind, action.message)
        : state;
    case "DOWNLOAD_START":
      return state.phase === "available"
        ? { ...state, phase: "downloading", downloadedBytes: 0, totalBytes: 0 }
        : state;
    case "DOWNLOAD_PROGRESS":
      return state.phase === "downloading"
        ? { ...state, downloadedBytes: action.downloadedBytes, totalBytes: action.totalBytes }
        : state;
    case "DOWNLOAD_COMPLETE":
      // The download must have made progress to be considered complete.
      return state.phase === "downloading" && state.totalBytes > 0
        ? { ...state, phase: "verifying_signature" }
        : state;
    case "DOWNLOAD_FAIL":
      return state.phase === "downloading"
        ? errorState(state, "download_failed", action.message)
        : state;
    case "SIGNATURE_VERIFYING":
      return state.phase === "verifying_signature" ? state : state;
    case "SIGNATURE_OK":
      return state.phase === "verifying_signature"
        ? { ...state, phase: "ready", signatureVerified: true }
        : state;
    case "SIGNATURE_INVALID":
      return state.phase === "verifying_signature"
        ? errorState(state, "signature_invalid", action.message)
        : state;
    case "BACKUP_MADE":
      return state.phase === "ready" || state.phase === "installing"
        ? { ...state, backupMade: true }
        : state;
    case "INSTALL_START":
      return state.phase === "ready" && state.signatureVerified
        ? { ...state, phase: "installing" }
        : state;
    case "INSTALL_DONE":
      return state.phase === "installing"
        ? { ...state, phase: "idle", availableVersion: null, downloadedBytes: 0, totalBytes: 0, signatureVerified: false, backupMade: false, error: null, attempt: 0 }
        : state;
    case "INSTALL_FAIL":
      return state.phase === "installing"
        ? errorState(state, "install_failed", action.message)
        : state;
    case "ROLLED_BACK":
      return state.phase === "error"
        ? { ...state, phase: "rolled_back", error: null, signatureVerified: false, backupMade: false }
        : state;
    case "RETRY":
      // Only recoverable failures may retry; signature failures MUST NOT retry
      // into a fresh install without a fresh validated package.
      return state.phase === "error" && isRetryable(state.error)
        ? { ...state, phase: "checking", error: null, attempt: state.attempt + 1, signatureVerified: false, backupMade: false }
        : state;
    case "RESET":
      return { ...initialUpdateState, currentVersion: state.currentVersion, channel: state.channel };
    default:
      return state;
  }
}

/** An error that can be retried (network / install). Signature failures are not. */
export function isRetryable(error: UpdateError | null): boolean {
  if (!error) return false;
  return (
    error.kind === "not_configured" ||
    error.kind === "check_failed" ||
    error.kind === "download_failed" ||
    error.kind === "install_failed"
  );
}

/** True while the machine is actively doing work (not idle/available/error). */
export function isUpdateActive(state: UpdateUiState): boolean {
  return (
    state.phase === "checking" ||
    state.phase === "downloading" ||
    state.phase === "verifying_signature" ||
    state.phase === "installing"
  );
}

/** Download progress in 0..1, or null when there is nothing to measure. */
export function downloadProgress(state: UpdateUiState): number | null {
  if (state.phase !== "downloading" || state.totalBytes <= 0) return null;
  return Math.min(1, state.downloadedBytes / state.totalBytes);
}

/** Latest user-facing status label, priority-ordered across phases. */
export function updateStatusLabel(state: UpdateUiState): string {
  switch (state.phase) {
    case "idle":
      return state.availableVersion ? `有新版本 ${state.availableVersion} 可安装` : "已是最新版本";
    case "checking":
      return "正在检查更新…";
    case "available":
      return `发现新版本 ${state.availableVersion ?? ""}`;
    case "downloading": {
      const progress = downloadProgress(state);
      return progress === null
        ? "正在下载更新…"
        : `正在下载更新… ${(progress * 100).toFixed(0)}%`;
    }
    case "verifying_signature":
      return "正在验证更新包签名…";
    case "ready":
      return state.backupMade
        ? "更新包签名已验证，已备份数据库，可安装"
        : "更新包签名已验证，可安装";
    case "installing":
      return "正在安装更新…";
    case "error":
      return state.error ? `更新失败：${state.error.message}` : "更新失败";
    case "rolled_back":
      return "更新失败，已回滚到当前版本";
  }
}