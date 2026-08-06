/**
 * API-key secure storage interface + diagnostic auto-desensitization.
 *
 * Defines the `SecureStorage` contract without tying it to any real Keychain
 * backend, plus an in-memory test double. Also provides pure redaction helpers
 * that mask API keys / tokens / passwords before they reach logs or diagnostic
 * exports (mirrors voxstudio_core/sanitize.py on the sidecar).
 */

/** Marker used in place of every redacted secret. */
export const REDACTED = "[REDACTED]";

export interface SecureStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

/** In-memory test double — NOT a real Keychain. Never use outside tests. */
export function createInMemorySecureStorage(): SecureStorage {
  const store = new Map<string, string>();
  return {
    async get(key) {
      return store.get(key) ?? null;
    },
    async set(key, value) {
      store.set(key, value);
    },
    async delete(key) {
      store.delete(key);
    },
  };
}

/** Default secret patterns detected even without an explicit secret list. */
export const DEFAULT_SECRET_PATTERNS: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{8,}/g,
  /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Redact every occurrence of any pattern (or literal secret) in `text`.
 * Patterns given as strings are matched as literal substrings.
 */
export function redactSecrets(
  text: string,
  patterns: readonly (string | RegExp)[],
): string {
  if (!text || patterns.length === 0) {
    return text;
  }
  let result = text;
  for (const pattern of patterns) {
    if (typeof pattern === "string") {
      result = pattern ? result.split(pattern).join(REDACTED) : result;
    } else {
      result = result.replace(pattern, REDACTED);
    }
  }
  return result;
}

/**
 * Redact every line of a diagnostic export given the actual secrets in play.
 * Literal secrets are escaped and combined with the default patterns.
 */
export function redactDiagnostic(
  logLines: readonly string[],
  secrets: readonly string[],
): string[] {
  const literalPatterns = secrets
    .filter((secret) => secret.length > 0)
    .map((secret) => new RegExp(escapeRegExp(secret), "g"));
  const patterns: readonly (string | RegExp)[] = [
    ...DEFAULT_SECRET_PATTERNS,
    ...literalPatterns,
  ];
  return logLines.map((line) => redactSecrets(line, patterns));
}