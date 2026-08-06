import { describe, expect, it } from "vitest";

import { createEchoGate, shouldAcceptMicFrame } from "./echoGate";

describe("echoGate", () => {
  it("suppresses a short burst right after playback begins (no AEC)", () => {
    const gate = createEchoGate();
    gate.onAssistantStarted(1000);
    expect(gate.audible).toBe(true);
    expect(gate.classifySpeechStart(1030)).toBe("suppress"); // short burst = echo
  });

  it("allows sustained user speech to pass through and barge in", () => {
    const gate = createEchoGate();
    gate.onAssistantStarted(1000);
    // Outside the echo window -> a real user utterance interrupts.
    expect(gate.classifySpeechStart(1500)).toBe("pass");
  });

  it("allows an ongoing utterance that survived a suppressed burst to interrupt", () => {
    const gate = createEchoGate();
    gate.onAssistantStarted(1000);
    // First burst is suppressed as echo...
    expect(gate.classifySpeechStart(1050)).toBe("suppress");
    // ...but the user keeps talking, so the next speech-start passes through.
    expect(gate.classifySpeechStart(1180)).toBe("pass");
  });

  it("does NOT permanently disable barge-in", () => {
    const gate = createEchoGate();
    // Not playing -> always pass.
    expect(gate.audible).toBe(false);
    expect(gate.classifySpeechStart(0)).toBe("pass");
    // Playback ends -> barge-in works again immediately.
    gate.onAssistantStarted(1000);
    gate.onAssistantEnded();
    expect(gate.audible).toBe(false);
    expect(gate.classifySpeechStart(1500)).toBe("pass");
  });

  it("exposes AEC availability and trusts it (passes barge-in during playback)", () => {
    const gate = createEchoGate({ echoCancellation: true });
    expect(gate.echoCancellation).toBe(true);
    gate.onAssistantStarted(1000);
    // Even right after playback begins, AEC handles the echo -> pass through.
    expect(gate.classifySpeechStart(1030)).toBe("pass");
    expect(gate.classifySpeechStart(1500)).toBe("pass");
  });

  it("defaults to no AEC", () => {
    const gate = createEchoGate();
    expect(gate.echoCancellation).toBe(false);
  });

  it("honors a custom short-burst window", () => {
    const gate = createEchoGate({ shortBurstWindowMs: 200 });
    gate.onAssistantStarted(1000);
    expect(gate.classifySpeechStart(1100)).toBe("suppress");
    expect(gate.classifySpeechStart(1300)).toBe("pass"); // beyond window
  });
});

describe("shouldAcceptMicFrame", () => {
  it("suppresses mic frames while TTS plays with no AEC", () => {
    expect(
      shouldAcceptMicFrame({
        isTtsPlaying: true,
        echoCancellation: false,
        msSinceTtsEnded: Infinity,
      }),
    ).toBe(false);
  });

  it("accepts mic frames while TTS plays when AEC is available", () => {
    expect(
      shouldAcceptMicFrame({
        isTtsPlaying: true,
        echoCancellation: true,
        msSinceTtsEnded: Infinity,
      }),
    ).toBe(true);
  });

  it("accepts frames when TTS has never played", () => {
    expect(
      shouldAcceptMicFrame({
        isTtsPlaying: false,
        echoCancellation: false,
        msSinceTtsEnded: Infinity,
      }),
    ).toBe(true);
  });

  it("keeps frames suppressed during the post-TTS cooldown", () => {
    // Default cooldown is 150ms; 50ms since TTS ended -> still suppressed.
    expect(
      shouldAcceptMicFrame({
        isTtsPlaying: false,
        echoCancellation: false,
        msSinceTtsEnded: 50,
      }),
    ).toBe(false);
  });

  it("accepts frames again once the cooldown has elapsed", () => {
    expect(
      shouldAcceptMicFrame({
        isTtsPlaying: false,
        echoCancellation: false,
        msSinceTtsEnded: 200,
      }),
    ).toBe(true);
  });

  it("honors a custom post-TTS cooldown", () => {
    const opts = {
      isTtsPlaying: false,
      echoCancellation: false,
      postTtsCooldownMs: 500,
    };
    expect(shouldAcceptMicFrame({ ...opts, msSinceTtsEnded: 300 })).toBe(false);
    expect(shouldAcceptMicFrame({ ...opts, msSinceTtsEnded: 500 })).toBe(true);
  });
});