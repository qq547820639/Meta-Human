/**
 * First-time cross-boundary consent tracking.
 *
 * A per-provider consent ledger. The first time a provider is used for a
 * remote or otherwise sensitive exchange the user is prompted; once granted,
 * later uses are silent until consent is explicitly revoked.
 */

import type { ProviderName } from "./providerPrivacy";
import type { DataFlowDisclosure } from "./dataFlow";
import { requiresConsent } from "./dataFlow";

export interface ConsentTracker {
  isGranted(provider: ProviderName): boolean;
  /** True on the first remote/sensitive use of a provider (not yet granted). */
  needsPrompt(
    provider: ProviderName,
    disclosure: DataFlowDisclosure,
  ): boolean;
  grant(provider: ProviderName): void;
  revoke(provider: ProviderName): void;
  /** All providers that have been granted so far. */
  grantedProviders(): readonly ProviderName[];
}

export function createConsentTracker(): ConsentTracker {
  const granted = new Set<ProviderName>();

  return {
    isGranted(provider) {
      return granted.has(provider);
    },
    needsPrompt(provider, disclosure) {
      if (granted.has(provider)) {
        return false;
      }
      return requiresConsent(disclosure);
    },
    grant(provider) {
      granted.add(provider);
    },
    revoke(provider) {
      granted.delete(provider);
    },
    grantedProviders() {
      return Array.from(granted);
    },
  };
}