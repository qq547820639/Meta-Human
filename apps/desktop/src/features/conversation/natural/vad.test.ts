import { describe, expect, it } from "vitest";

import {
  createVadDetector,
  frameRmsDb,
  mixToMono,
} from "./vad";

const FRAME = 480;
const SAMPLE_RATE = 16_000;

function silence(): Float32Array {
  return new Float32Array(FRAME);
}

function loud(): Float32Array {
  return new Float32Array(FRAME).fill(0.5);
}

function softNoise(): Float32Array {
  return new Float32Array(FRAME).fill(0.01);
}

describe("VAD detector", () => {
  it("computes RMS in dB (silence -> -Inf, loud -> ~-6dB)", () => {
    expect(frameRmsDb(silence())).toBe(-Infinity);
    // 0.5 amplitude -> 20*log10(0.5) ≈ -6.02
    expect(frameRmsDb(loud())).toBeCloseTo(-6.02, 1);
  });

  it("mixes stereo interleaved into mono", () => {
    const interleaved = new Float32Array([1, -1, 0.5, -0.5]);
    expect(Array.from(mixToMono(interleaved, 2))).toEqual([0, 0]);
  });

  it("stays silent while below threshold noise is fed", () => {
    const vad = createVadDetector({
      sampleRate: SAMPLE_RATE,
      frameSize: FRAME,
      thresholdDb: -30,
      speechFramesToStart: 4,
      silenceFramesToEnd: 12,
      minSpeechMs: 180,
    });
    let events: (string | null)[] = [];
    for (let i = 0; i < 40; i += 1) {
      events.push(vad.process(softNoise(), i * 30));
    }
    expect(events.every((e) => e === null)).toBe(true);
    expect(vad.speechActive).toBe(false);
  });

  it("raises speech_start after enough consecutive loud frames", () => {
    const vad = createVadDetector({
      sampleRate: SAMPLE_RATE,
      frameSize: FRAME,
      thresholdDb: -30,
      speechFramesToStart: 4,
      silenceFramesToEnd: 12,
      minSpeechMs: 180,
    });
    let result: string | null = null;
    for (let i = 0; i < 6 && !result; i += 1) {
      result = vad.process(loud(), i * 30);
    }
    expect(result).toBe("speech_start");
    expect(vad.speechActive).toBe(true);
  });

  it("raises speech_end after sustained silence following speech", () => {
    const vad = createVadDetector({
      sampleRate: SAMPLE_RATE,
      frameSize: FRAME,
      thresholdDb: -30,
      speechFramesToStart: 4,
      silenceFramesToEnd: 12,
      minSpeechMs: 180,
    });
    let sawStart = false;
    let sawEnd = false;
    for (let i = 0; i < 60; i += 1) {
      const frame = i < 10 ? loud() : silence();
      const ev = vad.process(frame, i * 30);
      if (ev === "speech_start") sawStart = true;
      if (ev === "speech_end") sawEnd = true;
    }
    expect(sawStart).toBe(true);
    expect(sawEnd).toBe(true);
    expect(vad.speechActive).toBe(false);
  });

  it("ignores blips shorter than minSpeechMs (a click)", () => {
    const vad = createVadDetector({
      sampleRate: SAMPLE_RATE,
      frameSize: FRAME,
      thresholdDb: -30,
      speechFramesToStart: 2,
      silenceFramesToEnd: 2,
      minSpeechMs: 500,
    });
    let sawStart = false;
    let sawEnd = false;
    // ~90ms of loud speech then silence -> below minSpeechMs
    for (let i = 0; i < 20; i += 1) {
      const frame = i < 3 ? loud() : silence();
      const ev = vad.process(frame, i * 30);
      if (ev === "speech_start") sawStart = true;
      if (ev === "speech_end") sawEnd = true;
    }
    expect(sawStart).toBe(true);
    // The short utterance must NOT produce a speech_end (it is ignored).
    expect(sawEnd).toBe(false);
    expect(vad.speechActive).toBe(false);
  });

  it("reset clears internal state", () => {
    const vad = createVadDetector();
    for (let i = 0; i < 6; i += 1) {
      vad.process(loud(), i * 30);
    }
    expect(vad.speechActive).toBe(true);
    vad.reset();
    expect(vad.speechActive).toBe(false);
  });
});

describe("VAD configurable endpoint detection", () => {
  function makeVad(minSilenceMs: number) {
    return createVadDetector({
      sampleRate: SAMPLE_RATE,
      frameSize: FRAME,
      thresholdDb: -30,
      speechFramesToStart: 2,
      silenceFramesToEnd: 12,
      minSpeechMs: 0,
      minSilenceMs,
    });
  }

  it("a shorter configured silence threshold triggers end-of-speech sooner", () => {
    const fast = makeVad(60); // 2 frames of silence at 30ms cadence
    const slow = makeVad(300);
    // Both start speaking identically.
    for (let i = 0; i < 3; i += 1) {
      fast.process(loud(), i * 30);
      slow.process(loud(), i * 30);
    }
    let fastEndAt = -1;
    let slowEndAt = -1;
    for (let i = 3; i < 20; i += 1) {
      if (fastEndAt < 0 && fast.process(silence(), i * 30) === "speech_end") {
        fastEndAt = i;
      }
      if (slowEndAt < 0 && slow.process(silence(), i * 30) === "speech_end") {
        slowEndAt = i;
      }
    }
    expect(fastEndAt).toBeGreaterThanOrEqual(0);
    expect(slowEndAt).toBeGreaterThanOrEqual(0);
    expect(fastEndAt).toBeLessThan(slowEndAt);
  });

  it("without minSilenceMs it falls back to the frame-count threshold (default behavior)", () => {
    const vad = createVadDetector({
      sampleRate: SAMPLE_RATE,
      frameSize: FRAME,
      thresholdDb: -30,
      speechFramesToStart: 2,
      silenceFramesToEnd: 3,
      minSpeechMs: 0,
    });
    let sawEnd = false;
    let endAt = -1;
    for (let i = 0; i < 20; i += 1) {
      const frame = i < 3 ? loud() : silence();
      const ev = vad.process(frame, i * 30);
      if (ev === "speech_end") {
        sawEnd = true;
        endAt = i;
      }
    }
    expect(sawEnd).toBe(true);
    // 3 consecutive silence frames (i=3,4,5) -> end at the 3rd (i=5).
    expect(endAt).toBe(5);
  });

  it("speechToEndTimeoutMs forces speech_end even while the user keeps speaking", () => {
    const vad = createVadDetector({
      sampleRate: SAMPLE_RATE,
      frameSize: FRAME,
      thresholdDb: -30,
      speechFramesToStart: 2,
      silenceFramesToEnd: 999, // silence threshold never reached alone
      minSpeechMs: 0,
      speechToEndTimeoutMs: 120, // 120ms of continuous speech -> forced end
    });
    let sawEnd = false;
    // Continuous loud frames (never silent) — only the timeout can end it.
    for (let i = 0; i < 30; i += 1) {
      const ev = vad.process(loud(), i * 30);
      if (ev === "speech_end") {
        sawEnd = true;
      }
    }
    expect(sawEnd).toBe(true);
  });

  it("still ignores blips shorter than minSpeechMs when using a time-based threshold", () => {
    const vad = createVadDetector({
      sampleRate: SAMPLE_RATE,
      frameSize: FRAME,
      thresholdDb: -30,
      speechFramesToStart: 2,
      silenceFramesToEnd: 2,
      minSpeechMs: 200,
      minSilenceMs: 60,
    });
    let sawEnd = false;
    // ~120ms of speech then silence; under minSpeechMs (200) -> ignored.
    for (let i = 0; i < 20; i += 1) {
      const frame = i < 3 ? loud() : silence();
      const ev = vad.process(frame, i * 30);
      if (ev === "speech_end") {
        sawEnd = true;
      }
    }
    expect(sawEnd).toBe(false);
    expect(vad.speechActive).toBe(false);
  });
});