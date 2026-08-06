/**
 * Correlation ID helpers for end-to-end observability.
 *
 * A correlation id ties a single user action (a send, a build, a restore) to
 * every log line, provider call and stage metric that happened while serving
 * it, so a diagnostic export can be replayed even when the original request
 * object is long gone.
 *
 * The id is a random 16-hex-char string generated without any browser API so
 * it is safe to call in workers / tests / jsdom.
 */

/** A correlation id is exactly 16 lowercase hex characters. */
const CORRELATION_ID_RE = /^[0-9a-f]{16}$/;

/**
 * Generate a random correlation id (16 hex chars). Uses `crypto.getRandomValues`
 * when available and falls back to a seeded `Math.random` byte stream otherwise
 * so the code stays testable and jsdom-safe.
 */
export function newCorrelationId(): string {
  const bytes = new Uint8Array(8);
  const cryptoGlobal =
    typeof crypto === "undefined"
      ? null
      : (crypto as { getRandomValues?: (arr: Uint8Array) => Uint8Array });
  if (cryptoGlobal && typeof cryptoGlobal.getRandomValues === "function") {
    cryptoGlobal.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** An envelope pairing a correlation id with the scope it was minted for. */
export interface CorrelationEnvelope {
  readonly correlationId: string;
  readonly scope: string;
}

/**
 * Wrap a scope with a correlation id. When `id` is omitted a fresh id is
 * generated, allowing callers to mint a new trace or to re-use an existing id
 * across scopes of the same logical operation.
 */
export function withCorrelation(scope: string, id?: string): CorrelationEnvelope {
  return { correlationId: id ?? newCorrelationId(), scope };
}

/** True when `id` is a well-formed correlation id (16 lowercase hex chars). */
export function isValidCorrelationId(id: string): boolean {
  return typeof id === "string" && CORRELATION_ID_RE.test(id);
}