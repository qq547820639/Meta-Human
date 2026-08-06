/**
 * Provider enable switches + master remote-off switch.
 *
 * Transparent privacy control: every provider can be individually disabled,
 * and a single master switch can cut *all* remote capability at once. The
 * master switch is the highest authority — when `remoteAllowed` is false, no
 * remote-capable provider may be used regardless of its individual flag.
 */

export type ProviderName =
  | "local"
  | "remote"
  | "feishu"
  | "stt"
  | "tts"
  | "llm"
  | "avatar";

/**
 * Providers that can cross the local boundary and reach the network. The
 * master `remoteAllowed` switch governs exactly this set; `local` is never
 * touched by `disableAllRemote`.
 */
export const REMOTE_CAPABLE_PROVIDERS: readonly ProviderName[] = [
  "remote",
  "feishu",
  "stt",
  "tts",
  "llm",
  "avatar",
];

export interface ProviderPrivacyState {
  /** Master switch: when false, no remote-capable provider may be used. */
  readonly remoteAllowed: boolean;
  /** Per-provider enable flags. `local` is always kept even when remote off. */
  readonly providers: Readonly<Record<ProviderName, boolean>>;
}

export function createProviderPrivacyState(): ProviderPrivacyState {
  const providers = {} as Record<ProviderName, boolean>;
  for (const name of [
    "local",
    "remote",
    "feishu",
    "stt",
    "tts",
    "llm",
    "avatar",
  ] as const) {
    providers[name] = true;
  }
  return { remoteAllowed: true, providers };
}

/**
 * Whether a provider may be used for remote work. Returns false when the
 * master switch is off OR the provider itself is disabled.
 */
export function canUseRemote(
  state: ProviderPrivacyState,
  provider: ProviderName,
): boolean {
  return state.remoteAllowed === true && state.providers[provider] === true;
}

/**
 * Kill all remote capability at once: turn off the master switch and disable
 * every remote-capable provider. The `local` provider is left untouched so a
 * fully-local mode can still function.
 */
export function disableAllRemote(
  state: ProviderPrivacyState,
): ProviderPrivacyState {
  const providers = { ...state.providers };
  for (const provider of REMOTE_CAPABLE_PROVIDERS) {
    providers[provider] = false;
  }
  return { remoteAllowed: false, providers };
}