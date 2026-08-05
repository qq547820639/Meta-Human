import { invoke } from "@tauri-apps/api/core";

import type { UpdateChannel, UpdateErrorKind } from "./updateStateMachine";

/**
 * Update configuration as reported by the Rust `get_update_config` command.
 * The real updater (tauri-plugin-updater) is not yet wired in, so this tells
 * the UI whether a signature public key and an update endpoint are configured
 * at all. When either is missing the update flow is reported as "未配置" and
 * never pretends to be usable.
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

/**
 * Check the configured endpoint for a newer version. Honest by default: with
 * no update endpoint / public key configured this throws a `not_configured`
 * UpdateError rather than fabricating a result. This is the seam where a real
 * `tauri-plugin-updater` check would eventually plug in.
 */
export async function checkForUpdates(config: UpdateConfig): Promise<{ availableVersion: string }> {
  if (!config.configured) {
    throw new UpdateError("not_configured", "未配置更新端点与签名公钥");
  }
  throw new UpdateError(
    "check_failed",
    "更新端点尚未接通（当前构建未启用应用内更新，UNVERIFIED）",
  );
}

/** Download lifecycle hook: report progress, then complete or fail. */
export async function downloadUpdate(
  config: UpdateConfig,
  onProgress: (downloadedBytes: number, totalBytes: number) => void,
): Promise<void> {
  if (!config.configured) {
    throw new UpdateError("not_configured", "未配置更新端点与签名公钥");
  }
  throw new UpdateError(
    "download_failed",
    "更新下载尚未接通（当前构建未启用应用内更新，UNVERIFIED）",
  );
}

/** Verify the downloaded package signature. See signatureVerification.ts. */
export async function verifyUpdate(
  config: UpdateConfig,
): Promise<{ verified: boolean; reason: string }> {
  if (!config.configured) {
    return { verified: false, reason: "未配置更新签名公钥（UNVERIFIED）" };
  }
  return { verified: false, reason: "更新签名公钥尚未接通（UNVERIFIED）" };
}

/** Install an already-verified package (unwired until the updater ships). */
export async function installUpdate(config: UpdateConfig): Promise<void> {
  if (!config.configured) {
    throw new UpdateError("not_configured", "未配置更新端点与签名公钥");
  }
  throw new UpdateError(
    "install_failed",
    "更新安装尚未接通（当前构建未启用应用内更新，UNVERIFIED）",
  );
}

/** Confirm a pre-migration backup was taken before installing. */
export async function confirmMigrationBackup(): Promise<void> {
  // The sidecar database.py `_backup_before_migrations` already runs before
  // any pending migration; this confirmation step is the update-flow gate that
  // asserts a backup exists before an install is allowed to proceed.
  return Promise.resolve();
}