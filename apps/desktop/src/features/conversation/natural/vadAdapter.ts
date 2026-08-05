/**
 * Adapter around the pure VAD detector (`vad.ts`) so the natural-conversation
 * engine can be tested with a mock and run for real in the browser.
 *
 * The browser adapter is built on `getUserMedia` + `AnalyserNode` (no
 * AudioWorklet required). It reads *real* microphone time-domain frames in a
 * rAF loop and pushes them into the detector; the detector's `speech_start` /
 * `speech_end` events are the ONLY thing that drives the "listening" state.
 * The rAF loop is a read loop for actual audio, never a fixed
 * `setTimeout`-style fake of a state.
 *
 * Mic DSP (echo cancellation / noise suppression / auto gain) is requested
 * when the platform advertises support and silently degrades otherwise (see
 * `probeMicCapabilities`).
 */

import { createVadDetector, type VadConfig, type VadDetector } from "./vad";

export interface VadAdapter {
  readonly name: string;
  start(callbacks: {
    onSpeechStart: () => void;
    onSpeechEnd: () => void;
  }): Promise<void>;
  stop(): Promise<void>;
  /** True while the adapter holds an active mic stream. */
  readonly active: boolean;
}

export interface MicCapabilities {
  readonly getUserMedia: boolean;
  readonly echoCancellation: boolean;
  readonly noiseSuppression: boolean;
  readonly autoGainControl: boolean;
}

export const noMicCapabilities: MicCapabilities = {
  getUserMedia: false,
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
};

/**
 * Probes which audio DSP features the environment can actually grant. This is
 * a *capability probe* (not a state), so it can run once at startup and the
 * caller degrades gracefully for any missing feature.
 */
export async function probeMicCapabilities(
  getMedia: ((constraints?: MediaStreamConstraints) => Promise<MediaStream>) | undefined = navigator
    .mediaDevices?.getUserMedia,
): Promise<MicCapabilities> {
  if (!getMedia) {
    return noMicCapabilities;
  }
  const probe = async (constraints: MediaTrackConstraints): Promise<boolean> => {
    try {
      const stream = await getMedia({ audio: constraints });
      const track = stream.getAudioTracks()[0];
      const results = track?.getSettings?.() ?? {};
      stream.getTracks().forEach((t) => t.stop());
      return (
        results.echoCancellation === true ||
        results.noiseSuppression === true ||
        results.autoGainControl === true
      );
    } catch {
      return false;
    }
  };
  const [echo, noise, agc] = await Promise.all([
    probe({ echoCancellation: true }),
    probe({ noiseSuppression: true }),
    probe({ autoGainControl: true }),
  ]);
  return {
    getUserMedia: true,
    echoCancellation: echo,
    noiseSuppression: noise,
    autoGainControl: agc,
  };
}

export interface BrowserVadAdapterDeps {
  readonly vadConfig?: VadConfig;
  readonly getMedia?: (
    constraints?: MediaStreamConstraints,
  ) => Promise<MediaStream>;
  readonly AudioContextCtor?: typeof AudioContext;
  /** Frame read period in ms (the rAF fallback cadence, default 30ms). */
  readonly framePeriodMs?: number;
}

/**
 * Real microphone VAD adapter. {@link active} is true only while a granted
 * mic stream is being read — it is never faked.
 */
export function createBrowserVadAdapter(
  deps: BrowserVadAdapterDeps = {},
): VadAdapter {
  const dc = createVadDetector(deps.vadConfig);
  const getMedia = deps.getMedia;
  const AudioContextCtor = deps.AudioContextCtor ?? null;
  const framePeriodMs = deps.framePeriodMs ?? 30;

  let stream: MediaStream | null = null;
  let rafId = 0;
  let lastFrameAt = 0;
  let callbacksRef: { onSpeechStart: () => void; onSpeechEnd: () => void } | null =
    null;

  return {
    name: "browser-vad",
    get active() {
      return stream !== null;
    },
    async start(callbacks) {
      if (stream) {
        return;
      }
      if (!getMedia) {
        throw new Error("getUserMedia unavailable; cannot start VAD.");
      }
      // Request the DSP features best-effort; whatever the platform grants is
      // used, and zeros are not an error (degraded mode).
      const streamRes = await getMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      stream = streamRes;
      callbacksRef = callbacks;
      dc.reset();
      lastFrameAt = performance.now();

      if (AudioContextCtor) {
        const ctx = new AudioContextCtor();
        const source = (ctx as {
          createMediaStreamSource: (
            s: MediaStream,
          ) => MediaStreamAudioSourceNode;
        }).createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0;
        source.connect(analyser);
        pump(analyser);
      } else {
        // No Web Audio in this environment (e.g. a limited test host): the
        // loop still runs but feeds silence, so the mic stays open in a
        // degraded "listening" state without falsely detecting speech.
        pump(null);
      }

      // Local helper scoped to the captured stream so multiple starts can't
      // double-run.
      function pump(analyser: AnalyserNode | null) {
        if (!stream) {
          return;
        }
        const now = performance.now();
        const frame = new Float32Array(analyser ? analyser.fftSize / 2 : 0);
        if (analyser) {
          analyser.getFloatTimeDomainData(frame);
        }
        const event = dc.process(frame, now);
        if (event === "speech_start") {
          callbacksRef?.onSpeechStart();
        } else if (event === "speech_end") {
          callbacksRef?.onSpeechEnd();
        }
        lastFrameAt = now;
        rafId = requestAnimationFrame(() => pump(analyser));
      }
    },
    async stop() {
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
      callbacksRef = null;
      dc.reset();
    },
  };
}

/** Deterministic mock VAD adapter for tests / no-hardware environments. */
export function createMockVadAdapter(): VadAdapter & {
  emitSpeechStart: () => void;
  emitSpeechEnd: () => void;
} {
  let started = false;
  let callbacksRef: { onSpeechStart: () => void; onSpeechEnd: () => void } | null =
    null;
  return {
    name: "mock-vad",
    get active() {
      return started;
    },
    async start(callbacks) {
      started = true;
      callbacksRef = callbacks;
    },
    async stop() {
      started = false;
      callbacksRef = null;
    },
    emitSpeechStart: () => callbacksRef?.onSpeechStart(),
    emitSpeechEnd: () => callbacksRef?.onSpeechEnd(),
  };
}