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
 * Production wiring: `getMedia` defaults to `navigator.mediaDevices.getUserMedia`
 * and the `AudioContext` ctor is resolved lazily from `window.AudioContext` /
 * `window.webkitAudioContext` at `start()` time, so SSR / test hosts without Web
 * Audio don't crash on import. If Web Audio (and thus a real frame pump) is not
 * available, `start()` rejects with a structured `VadStartError` instead of
 * faking a listening state — so the caller can fall back to push-to-talk.
 *
 * Mic DSP (echo cancellation / noise suppression / auto gain) is requested when
 * the platform advertises support and silently degrades otherwise (see
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
  /**
   * Release ALL resources (mic stream, Web Audio graph, rAF loop). Safe to call
   * multiple times.
   */
  dispose(): Promise<void>;
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

/** Structured reason a VAD adapter could not start. */
export type VadStartErrorReason =
  | "permission-denied"
  | "no-audio-context"
  | "no-getusermedia"
  | "device-error";

/**
 * Structured error thrown by {@link createBrowserVadAdapter#start} when the
 * real microphone + Web Audio pipeline cannot run. The caller can read
 * {@link reason} to fall back (e.g. push-to-talk) instead of faking "listening".
 */
export class VadStartError extends Error {
  readonly reason: VadStartErrorReason;
  /** Alias of {@link reason} for callers that want an explicit degradation flag. */
  readonly degradationReason: VadStartErrorReason;

  constructor(reason: VadStartErrorReason, message: string) {
    super(message);
    this.name = "VadStartError";
    this.reason = reason;
    this.degradationReason = reason;
  }
}

function isPermissionDenied(caught: unknown): boolean {
  if (typeof caught === "object" && caught !== null) {
    const name = (caught as { name?: unknown }).name;
    if (typeof name === "string") {
      const lower = name.toLowerCase();
      if (lower.includes("notallowed") || lower.includes("permission")) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Probes which audio DSP features the environment can actually grant. This is
 * a *capability probe* (not a state), so it can run once at startup and the
 * caller degrades gracefully for any missing feature.
 *
 * Uses a SINGLE `getUserMedia` call and reads `getSettings()` / `getCapabilities()`
 * for all three features, then stops the stream. A feature is reported as
 * enabled only when the platform reports it applied/supported; otherwise it is
 * treated as "unknown" -> false (degraded).
 */
export async function probeMicCapabilities(
  getMedia: ((constraints?: MediaStreamConstraints) => Promise<MediaStream>) | undefined =
    typeof navigator !== "undefined" ? navigator.mediaDevices?.getUserMedia : undefined,
): Promise<MicCapabilities> {
  if (!getMedia) {
    return noMicCapabilities;
  }
  let stream: MediaStream;
  try {
    stream = await getMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  } catch {
    return noMicCapabilities;
  }
  const track = stream.getAudioTracks()[0];
  const settings = track?.getSettings?.() ?? {};
  const capabilities = track?.getCapabilities?.() ?? {};
  stream.getTracks().forEach((t) => t.stop());

  const enabled = (
    key: "echoCancellation" | "noiseSuppression" | "autoGainControl",
  ): boolean => {
    const applied = settings[key];
    const supported = capabilities[key];
    if (applied === true) {
      return true;
    }
    if (Array.isArray(supported)) {
      return supported.includes(true);
    }
    if (supported === true) {
      return true;
    }
    return false;
  };

  return {
    getUserMedia: true,
    echoCancellation: enabled("echoCancellation"),
    noiseSuppression: enabled("noiseSuppression"),
    autoGainControl: enabled("autoGainControl"),
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
  const getMedia =
    deps.getMedia ??
    (typeof navigator !== "undefined" ? navigator.mediaDevices?.getUserMedia : undefined);
  const AudioContextCtor = deps.AudioContextCtor;
  const framePeriodMs = deps.framePeriodMs ?? 30;

  let stream: MediaStream | null = null;
  let ctx: AudioContext | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let analyser: AnalyserNode | null = null;
  let rafId = 0;
  let lastFrameAt = 0;
  let disposed = false;
  let callbacksRef: { onSpeechStart: () => void; onSpeechEnd: () => void } | null =
    null;

  /** Resolves the real AudioContext ctor lazily so SSR/test hosts don't crash. */
  function resolveAudioContextCtor(): typeof AudioContext | null {
    if (AudioContextCtor) {
      return AudioContextCtor;
    }
    if (typeof window === "undefined") {
      return null;
    }
    const w = window as unknown as {
      AudioContext?: typeof AudioContext;
      webkitAudioContext?: typeof AudioContext;
    };
    return w.AudioContext ?? w.webkitAudioContext ?? null;
  }

  /**
   * Shared teardown used by both {@link stop} and {@link dispose}. Extracted as
   * a closure function (not the object-literal `stop` method) so that
   * `dispose` cannot accidentally resolve the bare `stop` identifier to a
   * global (e.g. jsdom's `window.stop`), which would skip stream cleanup.
   */
  async function releaseResources(): Promise<void> {
    if (!stream) {
      return; // idempotent: not active
    }
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    source?.disconnect();
    source = null;
    analyser?.disconnect();
    analyser = null;
    const closing = ctx;
    ctx = null;
    if (closing && typeof closing.close === "function") {
      try {
        await closing.close();
      } catch {
        // Best-effort close; the stream is stopped regardless.
      }
    }
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    callbacksRef = null;
    dc.reset();
  }

  return {
    name: "browser-vad",
    get active() {
      return stream !== null;
    },
    async start(callbacks) {
      if (disposed) {
        return;
      }
      if (stream) {
        return; // idempotent: already active
      }
      if (!getMedia) {
        throw new VadStartError(
          "no-getusermedia",
          "当前环境不支持麦克风（getUserMedia 不可用），无法进入自然对话。",
        );
      }

      let streamRes: MediaStream;
      try {
        // Request the DSP features best-effort; whatever the platform grants is
        // used, and zeros are not an error (degraded mode).
        streamRes = await getMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      } catch (caught) {
        if (isPermissionDenied(caught)) {
          throw new VadStartError(
            "permission-denied",
            "麦克风权限被拒绝，无法进入自然对话。",
          );
        }
        throw new VadStartError(
          "device-error",
          "麦克风设备不可用，无法进入自然对话。",
        );
      }

      const Ctor = resolveAudioContextCtor();
      if (!Ctor) {
        // No Web Audio -> no real frame pump. Do NOT fake a listening state;
        // reject so the caller can fall back to push-to-talk.
        streamRes.getTracks().forEach((t) => t.stop());
        throw new VadStartError(
          "no-audio-context",
          "当前环境不支持 Web Audio，无法进行语音活动检测。",
        );
      }

      stream = streamRes;
      callbacksRef = callbacks;
      dc.reset();
      lastFrameAt = performance.now();

      ctx = new Ctor();
      source = ctx.createMediaStreamSource(stream);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0;
      source.connect(analyser);

      // Local helper scoped so multiple starts can't double-run the loop.
      function pump(): void {
        if (!stream || disposed) {
          return;
        }
        const now = performance.now();
        const analyserNode = analyser;
        // analyser is guaranteed non-null here (start rejects without Web Audio).
        const frame = new Float32Array(analyserNode ? analyserNode.fftSize / 2 : 0);
        if (analyserNode) {
          analyserNode.getFloatTimeDomainData(frame);
        }
        const event = dc.process(frame, now);
        if (event === "speech_start") {
          callbacksRef?.onSpeechStart();
        } else if (event === "speech_end") {
          callbacksRef?.onSpeechEnd();
        }
        lastFrameAt = now;
        rafId = requestAnimationFrame(pump);
      }
      pump();
    },
    async stop() {
      await releaseResources();
    },
    async dispose() {
      disposed = true;
      await releaseResources();
    },
  };
}

/** Deterministic mock VAD adapter for tests / no-hardware environments. */
export function createMockVadAdapter(): VadAdapter & {
  emitSpeechStart: () => void;
  emitSpeechEnd: () => void;
} {
  let started = false;
  let disposed = false;
  let callbacksRef: { onSpeechStart: () => void; onSpeechEnd: () => void } | null =
    null;
  return {
    name: "mock-vad",
    get active() {
      return started;
    },
    async start(callbacks) {
      if (disposed) {
        return;
      }
      started = true;
      callbacksRef = callbacks;
    },
    async stop() {
      started = false;
      callbacksRef = null;
    },
    async dispose() {
      disposed = true;
      started = false;
      callbacksRef = null;
    },
    emitSpeechStart: () => callbacksRef?.onSpeechStart(),
    emitSpeechEnd: () => callbacksRef?.onSpeechEnd(),
  };
}