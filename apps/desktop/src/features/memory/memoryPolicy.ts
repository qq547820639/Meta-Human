/**
 * Memory scope, expiry, sensitivity and long-term persistence policy.
 *
 * Pure, deterministic helpers. No browser / Tauri / network access.
 */

export type MemoryScope = "avatar" | "session" | "user";

/** Resolves a memory scope to the effective scope used for storage. */
export function resolveEffectiveScope(scope: MemoryScope): MemoryScope {
  return scope;
}

export interface ExpiryCheckInput {
  readonly storedAtMs: number;
  /** Lifetime in ms; null/undefined means the memory never expires. */
  readonly expiryMs: number | null;
  readonly nowMs: number;
}

/**
 * Whether a memory has expired. A memory with no expiry never expires; a
 * non-positive expiry expires immediately.
 */
export function isExpired(input: ExpiryCheckInput): boolean {
  const { storedAtMs, expiryMs, nowMs } = input;
  if (expiryMs == null) {
    return false;
  }
  if (expiryMs <= 0) {
    return true;
  }
  return nowMs >= storedAtMs + expiryMs;
}

export type SensitivityLevel = "low" | "medium" | "high";

const HIGH_SENSITIVITY_PATTERNS: RegExp[] = [
  /(?<!\d)1[3-9]\d{9}(?!\d)/, // CN mobile phone
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, // email
  /\b\d{17}[\dXx]\b/, // ID card
  /\b\d{4}[ ]?\d{4}[ ]?\d{4}[ ]?\d{4}\b/, // credit card
];

const MEDIUM_SENSITIVITY_PATTERNS: RegExp[] = [
  /(邮箱|邮箱地址|手机|手机号|电话|地址|身份证|银行卡|信用卡|密码|账号|家庭住址)/,
];

/**
 * Heuristic sensitivity level of a memory's content.
 *
 * - `high`: contains a phone, email, ID/credit-card number, or other
 *   directly-identifying value.
 * - `medium`: mentions a sensitive category (address, password, account…)
 *   without exposing the value itself.
 * - `low`: otherwise.
 */
export function sensitivityLevel(content: string): SensitivityLevel {
  if (!content) {
    return "low";
  }
  if (HIGH_SENSITIVITY_PATTERNS.some((pattern) => pattern.test(content))) {
    return "high";
  }
  if (MEDIUM_SENSITIVITY_PATTERNS.some((pattern) => pattern.test(content))) {
    return "medium";
  }
  return "low";
}

/**
 * Replaces sensitive values in a memory with safe placeholders so the content
 * can be shown/exported without leaking private data.
 */
export function desensitize(content: string): string {
  if (!content) {
    return content;
  }
  return content
    .replace(/(?<!\d)1[3-9]\d{9}(?!\d)/g, "[电话]")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[邮箱]")
    .replace(/\b\d{17}[\dXx]\b/g, "[身份证]")
    .replace(/\b\d{4}[ ]?\d{4}[ ]?\d{4}[ ]?\d{4}\b/g, "[银行卡]");
}

export interface PersistDecisionInput {
  readonly scope: MemoryScope;
  readonly expired: boolean;
  /** True when this is throwaway, temporary-session memory. */
  readonly tempSession: boolean;
}

/**
 * Whether a memory should be persisted to long-term storage.
 *
 * - Temporary-session memories are never persisted.
 * - Expired memories are never persisted.
 * - Otherwise persisted.
 */
export function shouldPersistToLongTerm(
  input: PersistDecisionInput,
): boolean {
  const { expired, tempSession } = input;
  if (tempSession) {
    return false;
  }
  if (expired) {
    return false;
  }
  return true;
}