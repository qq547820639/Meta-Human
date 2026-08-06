/**
 * Internationalization of errors.
 *
 * Localizes a stable error code into a translated, code-tagged message, and
 * strips technical details (stack frames, file paths) from a raw message so
 * only user-safe text reaches the UI.
 */

import { translate, type Lang, type TranslationKey } from "./i18n";

const ERROR_CODE_KEYS: Record<string, TranslationKey> = {
  offline: "error.offline",
  network: "network.offline",
  generic: "error.generic",
  unknown: "error.generic",
};

/**
 * Localizes a stable error code into a translated message prefixed with the
 * code. Unknown codes fall back to the generic error message while still
 * carrying their code tag.
 */
export function localizeError(code: string, lang: Lang): string {
  const key = ERROR_CODE_KEYS[code] ?? "error.generic";
  const message = translate(key, lang);
  return `[${code}] ${message}`;
}

const FILE_PATH =
  /(^|\/)[\w./-]+\.(ts|js|tsx|jsx|cjs|mjs)(:\d+){1,2}/i;

/**
 * Removes stack-trace frames and internal file paths from a message, leaving
 * only human-readable text. Used before rendering any error detail.
 */
export function stripTechnicalDetails(msg: string): string {
  return msg
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^\s*at\s/.test(line))
    .filter((line) => !FILE_PATH.test(line))
    .filter((line) => !/node_modules/i.test(line))
    .join(" ");
}