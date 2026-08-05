import { describe, expect, it } from "vitest";

import { createEchoGate } from "./echoGate";

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