import { describe, expect, it } from "vitest";

import {
  applyPrivacyChange,
  assertNotSilent,
} from "./privacyEnforcement";
import { createProviderPrivacyState } from "./providerPrivacy";

describe("applyPrivacyChange", () => {
  it("applies remote-allowed changes immediately", () => {
    const state = createProviderPrivacyState();
    const next = applyPrivacyChange(state, {
      kind: "set_remote_allowed",
      remoteAllowed: false,
    });
    expect(next.remoteAllowed).toBe(false);
    // Original is untouched (immutability).
    expect(state.remoteAllowed).toBe(true);
  });

  it("applies per-provider enable changes immediately", () => {
    const state = createProviderPrivacyState();
    const next = applyPrivacyChange(state, {
      kind: "set_provider_enabled",
      provider: "feishu",
      enabled: false,
    });
    expect(next.providers.feishu).toBe(false);
    expect(state.providers.feishu).toBe(true);
  });
});

describe("assertNotSilent", () => {
  it("flags cost-raising actions as non-silent", () => {
    const check = assertNotSilent("raise_cost");
    expect(check.silent).toBe(false);
    expect(check.reason.length).toBeGreaterThan(0);
  });

  it("flags privacy-uploading actions as non-silent", () => {
    expect(assertNotSilent("upload_privacy").silent).toBe(false);
    expect(assertNotSilent("upload_privacy").reason.length).toBeGreaterThan(0);
  });

  it("flags remote-resource-creation actions as non-silent", () => {
    expect(assertNotSilent("create_remote_resource").silent).toBe(false);
    expect(
      assertNotSilent("create_remote_resource").reason.length,
    ).toBeGreaterThan(0);
  });

  it("flags credential saves as non-silent", () => {
    expect(assertNotSilent("save_credential").silent).toBe(false);
  });

  it("allows benign actions to be silent", () => {
    for (const action of ["send_message", "read_local", "view_status"] as const) {
      const check = assertNotSilent(action);
      expect(check.silent).toBe(true);
      expect(check.reason).toBe("");
    }
  });
});