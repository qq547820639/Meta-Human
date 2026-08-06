/**
 * Privacy-settings immediate-effect + non-silent sensitive actions.
 *
 * Privacy changes take effect immediately (pure state transitions), and
 * sensitive actions — those that raise cost, upload privacy data, or create
 * remote resources — must never run silently: they must be surfaced with an
 * explicit reason requiring consent/notice.
 */

import type {
  ProviderName,
  ProviderPrivacyState,
} from "./providerPrivacy";

export type PrivacyChange =
  | { readonly kind: "set_remote_allowed"; readonly remoteAllowed: boolean }
  | { readonly kind: "set_provider_enabled"; readonly provider: ProviderName; readonly enabled: boolean };

/**
 * Apply a privacy change and return the resulting state (immediate effect —
 * no deferred application).
 */
export function applyPrivacyChange(
  state: ProviderPrivacyState,
  change: PrivacyChange,
): ProviderPrivacyState {
  switch (change.kind) {
    case "set_remote_allowed":
      return { ...state, remoteAllowed: change.remoteAllowed };
    case "set_provider_enabled":
      return {
        ...state,
        providers: {
          ...state.providers,
          [change.provider]: change.enabled,
        },
      };
  }
}

export type PrivacyAction =
  | "raise_cost"
  | "upload_privacy"
  | "create_remote_resource"
  | "save_credential"
  | "disable_remote"
  | "send_message"
  | "read_local"
  | "view_status";

export interface SilentCheck {
  readonly silent: boolean;
  /** Non-empty when the action must NOT be silent (demands consent/notice). */
  readonly reason: string;
}

const SENSITIVE_ACTIONS: Partial<Record<PrivacyAction, string>> = {
  raise_cost: "该操作将产生云成本，需明确告知并征得同意。",
  upload_privacy: "该操作将上传隐私数据，需获得明确同意。",
  create_remote_resource: "该操作将在云端创建资源，需告知用户并征得同意。",
  save_credential: "该操作将保存凭据，需明确提示用户。",
  disable_remote: "该操作将关闭远程能力，需明确告知用户。",
};

/**
 * Benign actions run silently; sensitive actions are flagged with a reason.
 * An action that raises cost / uploads privacy data / creates a remote
 * resource must not be silent.
 */
export function assertNotSilent(action: PrivacyAction): SilentCheck {
  const reason = SENSITIVE_ACTIONS[action] ?? "";
  return { silent: reason === "", reason };
}