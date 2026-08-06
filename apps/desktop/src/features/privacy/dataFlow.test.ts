import { describe, expect, it } from "vitest";

import { describeDataFlow, requiresConsent } from "./dataFlow";

describe("dataFlow", () => {
  it("crossing the local boundary requires consent", () => {
    const disclosure = describeDataFlow({
      provider: "remote",
      kinds: ["text"],
      remoteBoundary: true,
    });
    expect(disclosure.leavesLocal).toBe(false);
    expect(disclosure.kindsSent).toEqual(["text"]);
    expect(disclosure.humanSummary).toContain("离开本机");
    expect(requiresConsent(disclosure)).toBe(true);
  });

  it("local-only flows do not require consent", () => {
    const disclosure = describeDataFlow({
      provider: "local",
      kinds: ["text", "audio"],
      remoteBoundary: false,
    });
    expect(disclosure.leavesLocal).toBe(true);
    expect(disclosure.humanSummary).toContain("仅在本机");
    expect(requiresConsent(disclosure)).toBe(false);
  });

  it("photo and document are inherently sensitive even when local", () => {
    const photo = describeDataFlow({
      provider: "local",
      kinds: ["photo"],
      remoteBoundary: false,
    });
    expect(requiresConsent(photo)).toBe(true);

    const doc = describeDataFlow({
      provider: "feishu",
      kinds: ["document"],
      remoteBoundary: false,
    });
    expect(requiresConsent(doc)).toBe(true);
  });

  it("mixed kinds crossing the boundary are flagged", () => {
    const disclosure = describeDataFlow({
      provider: "stt",
      kinds: ["audio", "text"],
      remoteBoundary: true,
    });
    expect(requiresConsent(disclosure)).toBe(true);
  });
});