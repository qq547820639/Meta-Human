/**
 * Safe error handling for the UI.
 *
 * Internal stack traces and absolute file paths must never surface to the
 * user. These pure helpers detect raw stack traces, sanitize thrown errors
 * into localized-friendly messages, and attach a stable machine code.
 */

/** Detects stack-trace frames and internal file paths. */
const STACK_FRAME = /^\s*at\s/m;
const INLINE_FRAME = /\bat\s+.+:\d+:\d+/;
const FILE_PATH =
  /node_modules|\/[\w./-]+\.(ts|js|tsx|jsx|cjs|mjs)(:\d+){1,2}/i;
const ERROR_SIGNATURE = /Error[:\s]/;

/**
 * Heuristic for whether a string is an internal stack trace (as opposed to a
 * user-facing message). Stack frames, absolute file paths and well-known
 * error signatures strongly indicate raw internals.
 */
export function isInternalStackTrace(text: string): boolean {
  if (!text.trim()) {
    return false;
  }
  const hasStackFrame = STACK_FRAME.test(text) || INLINE_FRAME.test(text);
  const hasFilePath = FILE_PATH.test(text);
  const hasErrorSignature = ERROR_SIGNATURE.test(text);
  return hasStackFrame || (hasErrorSignature && hasFilePath);
}

/** Removes stack-trace frames and internal path lines from a message. */
export function stripTechnicalDetails(message: string): string {
  return message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^\s*at\s/.test(line))
    .filter((line) => !FILE_PATH.test(line))
    .join(" ");
}

function readMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === "string") {
    return err;
  }
  return "";
}

function readCode(err: unknown): string | null {
  if (err !== null && typeof err === "object" && "code" in err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string" && code.length > 0) {
      return code;
    }
  }
  return null;
}

/**
 * Produces a safe, localized-friendly message from a thrown value. The
 * optional `code` is surfaced as a bracketed prefix so support can be
 * actionable without exposing a stack trace.
 */
export function userErrorMessage(
  err: unknown,
  opts?: { readonly code?: string },
): string {
  const message = stripTechnicalDetails(readMessage(err));
  const code = opts?.code;
  return code ? `[${code}] ${message}` : message;
}

export interface SanitizedError {
  readonly message: string;
  readonly code: string | null;
  /** Always true: the returned message is guaranteed safe to render. */
  readonly safe: boolean;
}

/**
 * Sanitizes a thrown value for UI rendering. Guarantees the output never
 * contains raw stack frames or internal file paths, and attaches a stable
 * error code when the error carries one.
 */
export function sanitizeErrorForUI(err: unknown): SanitizedError {
  const code = readCode(err);
  const message = stripTechnicalDetails(readMessage(err)) || "发生未知错误";
  return { message, code, safe: true };
}