import { describe, expect, it } from "vitest";

import {
  canUseRemote,
  createProviderPrivacyState,
  disableAllRemote,
  REMOTE_CAPABLE_PROVIDERS,
} from "./providerPrivacy";

describe("providerPrivacy", () => {
  it("starts with all providers enabled and the master switch on", () => {
    const state = createProviderPrivacyState();
    expect(state.remoteAllowed).toBe(true);
    for (const provider of REMOTE_CAPABLE_PROVIDERS) {
      expect(canUseRemote(state, provider)).toBe(true);
    }
  });

  it("master switch overrides individual enabled flags", () => {
    const base = createProviderPrivacyState();
    const disabled = {
      ...base,
      providers: { ...base.providers, remote: false },
    };
    // Per-provider off blocks that provider.
    expect(canUseRemote(disabled, "remote")).toBe(false);
    expect(canUseRemote(disabled, "tts")).toBe(true);

    // Master off blocks everything remote regardless of individual flags.
    const masterOff = { ...base, remoteAllowed: false };
    for (const provider of REMOTE_CAPABLE_PROVIDERS) {
      expect(canUseRemote(masterOff, provider)).toBe(false);
    }
    // Even an individually-enabled provider is blocked by the master switch.
    expect(canUseRemote(masterOff, "tts")).toBe(false);
  });

  it("per-provider off only affects that provider", () => {
    const state = createProviderPrivacyState();
    const updated = {
      ...state,
      providers: { ...state.providers, feishu: false },
    };
    expect(canUseRemote(updated, "feishu")).toBe(false);
    expect(canUseRemote(updated, "local")).toBe(true);
    expect(canUseRemote(updated, "avatar")).toBe(true);
  });

  it("disableAllRemote turns off the master switch and every remote provider", () => {
    const state = createProviderPrivacyState();
    const off = disableAllRemote(state);
    expect(off.remoteAllowed).toBe(false);
    for (const provider of REMOTE_CAPABLE_PROVIDERS) {
      expect(canUseRemote(off, provider)).toBe(false);
      expect(off.providers[provider]).toBe(false);
    }
    // Local stays usable.
    expect(off.providers.local).toBe(true);
  });
});