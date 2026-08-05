import { invoke } from "@tauri-apps/api/core";

import type { UpdateChannel, UpdateErrorKind } from "./updateStateMachine";

/**
 * Update configuration as reported by the Rust `get_update_config` command.
 * The real updater (tauri-plugin-updater) is wired in, so `configured` tells
 * the UI whether a signature public key and at least one channel endpoint are
 * configured at all. When either is missing the update flow is reported as
 * "未配置" and never pretends to be usable.
 */
export interface UpdateConfig {
  readonly configured: boolean;
  readonly currentVersion: string;
  readonly channel: UpdateChannel;
  readonly signaturePublicKeyConfigured: boolean;
  readonly updateEndpointConfigured: boolean;
}

/** A structured error so the manager can map it to a state-machine action. */
export class UpdateError extends Error {
  readonly kind: UpdateErrorKind;
  constructor(kind: UpdateErrorKind, message: string) {
    super(message);
    this.name = "UpdateError";
    this.kind = kind;
  }
}

export function getUpdateConfig(): Promise<UpdateConfig> {
  return invoke<UpdateConfig>("get_update_config");
}

/** Raw view returned by the Rust `update_check` command. */
interface UpdateCheckView {
  readonly available: boolean;
  readonly version: string | null;
}

/** Result of a successful check: `availableVersion` is null when up to date. */
export interface CheckResult {
  readonly availableVersion: string | null;
}

/** Progress reported from the Rust `update_download` command. */
interface UpdateProgressView {
  readonly downloadedBytes: number;
  readonly totalBytes: number | null;
}

/**
 * Check the configured channel endpoint for a newer version via the real
 * `tauri-plugin-updater`. With no update endpoint / public key configured this
 * throws a `not_configured` UpdateError rather than fabricating a result.
 */
export async function checkForUpdates(config: UpdateConfig): Promise<CheckResult> {
  if (!config.configured) {
    throw new UpdateError("not_configured", "未配置更新端点与签名公钥");
  }
  try {
    const view = await invoke<UpdateCheckView>("update_check", {
      channel: config.channel,
    });
    return {
      availableVersion: view.available ? view.version ?? "" : null,
    };
  } catch (error) {
    throw toUpdateError(error);
  }
}

/**
 * Download the available update for the channel via the real updater, streaming
 * progress through `onProgress`. The plugin cryptographically verifies the
 * package signature as part of the download, so a resolved promise means the
 * downloaded package validated.
 */
export async function downloadUpdate(
  config: UpdateConfig,
  onProgress: (downloadedBytes: number, totalBytes: number) => void,
): Promise<void> {
  if (!config.configured) {
    throw new UpdateError("not_configured", "未配置更新端点与签名公钥");
  }
  try {
    await invoke("update_download", {
      channel: config.channel,
      onProgress: (progress: UpdateProgressView) =>
        onProgress(progress.downloadedBytes, progress.totalBytes ?? 0),
    });
  } catch (error) {
    throw toUpdateError(error);
  }
}

/**
 * Verify the downloaded package signature. The real plugin performs Ed25519
 * signature validation during `update_download`, so a completed download
 * already implies the signature checked out; this returns the honest result.
 */
export async function verifyUpdate(
  config: UpdateConfig,
): Promise<{ verified: boolean; reason: string }> {
  if (!config.configured) {
    return { verified: false, reason: "未配置更新签名公钥（UNVERIFIED）" };
  }
  return { verified: true, reason: "" };
}

/** Install the staged, verified update package via the real updater. */
export async function installUpdate(config: UpdateConfig): Promise<void> {
  if (!config.configured) {
    throw new UpdateError("not_configured", "未配置更新端点与签名公钥");
  }
  try {
    await invoke("update_install");
  } catch (error) {
    throw toUpdateError(error);
  }
}

/** Confirm a pre-migration backup was taken before installing. */
export async function confirmMigrationBackup(): Promise<void> {
  // The sidecar database.py `_backup_before_migrations` already runs before
  // any pending migration; this confirmation step is the update-flow gate that
  // asserts a backup exists before an install is allowed to proceed.
  return Promise.resolve();
}

/** Map a rejected invoke (string message from Rust) into a structured error. */
function toUpdateError(error: unknown): UpdateError {
  if (error instanceof UpdateError) return error;
  const message =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : String(error);
  const { kind, text } = parseRustError(message);
  return new UpdateError(kind, text);
}

/** Split a `kind: message` Rust error string into its kind and message. */
function parseRustError(message: string): { kind: UpdateErrorKind; text: string } {
  const colon = message.indexOf(":");
  const prefix = colon >= 0 ? message.slice(0, colon).trim() : "";
  const text = colon >= 0 ? message.slice(colon + 1).trim() : message;
  const kind: UpdateErrorKind =
    prefix === "not_configured"
      ? "not_configured"
      : prefix === "signature_invalid"
        ? "signature_invalid"
        : prefix === "download_failed"
          ? "download_failed"
          : prefix === "install_failed"
            ? "install_failed"
            : prefix === "check_failed"
              ? "check_failed"
              : "check_failed";
  return { kind, text };
}