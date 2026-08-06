/**
 * Minimal i18n dictionary and lookup.
 *
 * A small, typed dictionary covering the common actions, error messages,
 * streaming-state labels, confirmations and offline notices that the P2
 * accessibility/localization work touches. Missing keys fall back to the key
 * itself so the UI never renders a blank string.
 */

export type Lang = "zh-CN" | "en-US";

export type TranslationKey =
  | "common.ok"
  | "common.cancel"
  | "common.retry"
  | "common.save"
  | "common.retryIn"
  | "error.generic"
  | "error.offline"
  | "state.listening"
  | "state.thinking"
  | "state.speaking"
  | "state.interrupted"
  | "confirm.delete"
  | "network.offline";

const DICTIONARY: Record<Lang, Record<TranslationKey, string>> = {
  "zh-CN": {
    "common.ok": "确定",
    "common.cancel": "取消",
    "common.retry": "重试",
    "common.save": "保存",
    "common.retryIn": "将在 {seconds} 秒后重试",
    "error.generic": "发生未知错误",
    "error.offline": "当前处于离线状态",
    "state.listening": "正在聆听",
    "state.thinking": "正在思考",
    "state.speaking": "正在说话",
    "state.interrupted": "对话已打断",
    "confirm.delete": "确定要删除吗？",
    "network.offline": "网络连接已断开",
  },
  "en-US": {
    "common.ok": "OK",
    "common.cancel": "Cancel",
    "common.retry": "Retry",
    "common.save": "Save",
    "common.retryIn": "Retrying in {seconds} seconds",
    "error.generic": "An unknown error occurred",
    "error.offline": "You are currently offline",
    "state.listening": "Listening",
    "state.thinking": "Thinking",
    "state.speaking": "Speaking",
    "state.interrupted": "Interrupted",
    "confirm.delete": "Are you sure you want to delete?",
    "network.offline": "Network connection lost",
  },
};

export type TranslationParams = Record<string, string | number>;

/**
 * Looks up `key` for `lang`, interpolating `{name}` placeholders from
 * `params`. A missing key falls back to the key itself.
 */
export function translate(
  key: TranslationKey,
  lang: Lang,
  params?: TranslationParams,
): string {
  let text = DICTIONARY[lang][key] ?? key;
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${name}\\}`, "g"), String(value));
    }
  }
  return text;
}

/** Shorthand for `translate(key, lang)` without interpolation. */
export function t(key: TranslationKey, lang: Lang): string {
  return translate(key, lang);
}