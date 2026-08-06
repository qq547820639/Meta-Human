import { describe, expect, it } from "vitest";

import { createConsentTracker } from "./consent";
import { describeDataFlow } from "./dataFlow";

const sensitive = describeDataFlow({
  provider: "remote",
  kinds: ["text"],
  remoteBoundary: true,
});

const benign = describeDataFlow({
  provider: "local",
  kinds: ["text"],
  remoteBoundary: false,
});

describe("consent", () => {
  it("prompts on first remote/sensitive use", () => {
    const tracker = createConsentTracker();
    expect(tracker.needsPrompt("remote", sensitive)).toBe(true);
    expect(tracker.isGranted("remote")).toBe(false);
  });

  it("does not prompt after grant", () => {
    const tracker = createConsentTracker();
    tracker.grant("remote");
    expect(tracker.isGranted("remote")).toBe(true);
    expect(tracker.needsPrompt("remote", sensitive)).toBe(false);
  });

  it("does not prompt for benign local use even without grant", () => {
    const tracker = createConsentTracker();
    expect(tracker.needsPrompt("local", benign)).toBe(false);
  });

  it("revoke forces a re-prompt", () => {
    const tracker = createConsentTracker();
    tracker.grant("remote");
    expect(tracker.needsPrompt("remote", sensitive)).toBe(false);
    tracker.revoke("remote");
    expect(tracker.isGranted("remote")).toBe(false);
    expect(tracker.needsPrompt("remote", sensitive)).toBe(true);
  });

  it("tracks granted providers independently", () => {
    const tracker = createConsentTracker();
    tracker.grant("remote");
    tracker.grant("avatar");
    expect(tracker.grantedProviders()).toEqual(["remote", "avatar"]);
    expect(tracker.needsPrompt("tts", sensitive)).toBe(true);
  });
});