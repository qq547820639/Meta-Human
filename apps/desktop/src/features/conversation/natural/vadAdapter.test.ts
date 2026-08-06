import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createBrowserVadAdapter,
  noMicCapabilities,
  probeMicCapabilities,
} from "./vadAdapter";

const originalRaf = global.requestAnimationFrame;
const originalCaf = global.cancelAnimationFrame;

function stubRaf() {
  global.requestAnimationFrame = (() => 1) as typeof requestAnimationFrame;
  global.cancelAnimationFrame = (() => undefined) as typeof cancelAnimationFrame;
}

afterEach(() => {
  global.requestAnimationFrame = originalRaf;
  global.cancelAnimationFrame = originalCaf;
  vi.restoreAllMocks();
});

function makeStream() {
  const track = { stop: vi.fn() };
  const stream = {
    getTracks: () => [track],
    getAudioTracks: () => [track],
  };
  return { stream, track };
}

function makeAnalyser() {
  return {
    fftSize: 1024,
    smoothingTimeConstant: 0,
    getFloatTimeDomainData: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
}

/** Builds a real class constructor (callable with `new`) for the VAD adapter. */
function makeAudioContext() {
  const analyser = makeAnalyser();
  const source = { connect: vi.fn(), disconnect: vi.fn() };
  const createMediaStreamSource = vi.fn(() => source);
  const createAnalyser = vi.fn(() => analyser);
  const close = vi.fn(async () => undefined);
  class FakeAudioContext {
    createMediaStreamSource = createMediaStreamSource;
    createAnalyser = createAnalyser;
    close = close;
  }
  return {
    Ctor: FakeAudioContext as unknown as typeof AudioContext,
    analyser,
    source,
    createMediaStreamSource,
    createAnalyser,
    close,
  };
}

describe("createBrowserVadAdapter", () => {
  it("no getUserMedia -> throws VadStartError no-getusermedia", async () => {
    stubRaf();
    const adapter = createBrowserVadAdapter({
      getMedia: undefined,
      AudioContextCtor: makeAudioContext().Ctor,
    });
    await expect(
      adapter.start({ onSpeechStart: () => {}, onSpeechEnd: () => {} }),
    ).rejects.toMatchObject({ name: "VadStartError", reason: "no-getusermedia" });
  });

  it("permission denial -> throws VadStartError permission-denied", async () => {
    stubRaf();
    // Real browsers reject getUserMedia with a DOMException whose `name` is
    // "NotAllowedError"; mirror that contract so the mapper hits the right branch.
    const denied = new Error("mic permission denied");
    denied.name = "NotAllowedError";
    const getMedia = vi.fn().mockRejectedValue(denied);
    const adapter = createBrowserVadAdapter({
      getMedia,
      AudioContextCtor: makeAudioContext().Ctor,
    });
    await expect(
      adapter.start({ onSpeechStart: () => {}, onSpeechEnd: () => {} }),
    ).rejects.toMatchObject({ name: "VadStartError", reason: "permission-denied" });
  });

  it("device error -> throws VadStartError device-error", async () => {
    stubRaf();
    const getMedia = vi.fn().mockRejectedValue(new Error("NotFoundError"));
    const adapter = createBrowserVadAdapter({
      getMedia,
      AudioContextCtor: makeAudioContext().Ctor,
    });
    await expect(
      adapter.start({ onSpeechStart: () => {}, onSpeechEnd: () => {} }),
    ).rejects.toMatchObject({ name: "VadStartError", reason: "device-error" });
  });

  it("no Web Audio -> throws VadStartError no-audio-context and stops the stream", async () => {
    stubRaf();
    const { stream, track } = makeStream();
    const getMedia = vi.fn().mockResolvedValue(stream);
    const adapter = createBrowserVadAdapter({ getMedia, AudioContextCtor: undefined });
    await expect(
      adapter.start({ onSpeechStart: () => {}, onSpeechEnd: () => {} }),
    ).rejects.toMatchObject({ name: "VadStartError", reason: "no-audio-context" });
    expect(track.stop).toHaveBeenCalled();
  });

  it("starts a real mic pipeline and becomes active", async () => {
    stubRaf();
    const { stream } = makeStream();
    const getMedia = vi.fn().mockResolvedValue(stream);
    const { Ctor, analyser, source, createMediaStreamSource, createAnalyser } =
      makeAudioContext();
    const adapter = createBrowserVadAdapter({ getMedia, AudioContextCtor: Ctor });

    await adapter.start({ onSpeechStart: () => {}, onSpeechEnd: () => {} });
    expect(adapter.active).toBe(true);
    expect(getMedia).toHaveBeenCalledWith({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    expect(createMediaStreamSource).toHaveBeenCalledWith(stream);
    expect(createAnalyser).toHaveBeenCalled();
    expect(source.connect).toHaveBeenCalledWith(analyser);
    expect(analyser.getFloatTimeDomainData).toHaveBeenCalled();
  });

  it("stop() closes the context, stops tracks and becomes inactive; repeated stop is idempotent", async () => {
    stubRaf();
    const { stream, track } = makeStream();
    const getMedia = vi.fn().mockResolvedValue(stream);
    const { Ctor, close } = makeAudioContext();
    const adapter = createBrowserVadAdapter({ getMedia, AudioContextCtor: Ctor });

    await adapter.start({ onSpeechStart: () => {}, onSpeechEnd: () => {} });
    await adapter.stop();
    expect(adapter.active).toBe(false);
    expect(close).toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalled();
    // Idempotent: a second stop must not throw or re-close.
    await expect(adapter.stop()).resolves.toBeUndefined();
  });

  it("dispose() releases resources and stops the stream", async () => {
    stubRaf();
    const { stream, track } = makeStream();
    const getMedia = vi.fn().mockResolvedValue(stream);
    const { Ctor, close } = makeAudioContext();
    const adapter = createBrowserVadAdapter({ getMedia, AudioContextCtor: Ctor });

    await adapter.start({ onSpeechStart: () => {}, onSpeechEnd: () => {} });
    await adapter.dispose();
    expect(adapter.active).toBe(false);
    expect(close).toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalled();
  });
});

describe("probeMicCapabilities", () => {
  it("returns no capabilities when getUserMedia is unavailable", async () => {
    await expect(probeMicCapabilities(undefined)).resolves.toEqual(
      noMicCapabilities,
    );
  });

  it("reports echoCancellation from a single real stream's settings", async () => {
    const track = {
      getSettings: () => ({
        echoCancellation: true,
        noiseSuppression: false,
        autoGainControl: true,
      }),
      getCapabilities: () => ({}),
      stop: vi.fn(),
    };
    const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
    const getMedia = vi.fn().mockResolvedValue(stream);
    const caps = await probeMicCapabilities(getMedia);
    expect(caps).toEqual({
      getUserMedia: true,
      echoCancellation: true,
      noiseSuppression: false,
      autoGainControl: true,
    });
    expect(getMedia).toHaveBeenCalledTimes(1);
    expect(track.stop).toHaveBeenCalled();
  });
});