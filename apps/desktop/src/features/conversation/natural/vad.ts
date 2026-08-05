/**
 * Energy-threshold voice activity detection (VAD).
 *
 * The detector is a pure, injectable classifier: you feed it a time-domain
 * PCM frame (a `Float32Array` in [-1, 1]) and it returns an event when speech
 * clearly starts or clearly ends. It holds NO timers — the caller drives it
 * with real audio frames from an `AudioWorklet` / `AnalyserNode` / `MediaRecorder`
 * and supplies the current time, so the "listening" state is always driven by
 * real microphone activity, never by a fixed `setTimeout`.
 *
 * Decision logic (hysteresis to avoid flicker):
 *   - Compute the frame RMS and convert to dB.
 *   - A run of `speechFramesToStart` consecutive frames above `thresholdDb`
 *     raises `speech_start`.
 *   - While speech is active, a run of `silenceFramesToEnd` consecutive frames
 *     below `thresholdDb` lowers `speech_end` (unless the utterance was
 *     shorter than `minSpeechMs`, in which case it is treated as a click and
 *     ignored).
 */

export interface VadConfig {
  /** Microphone sample rate in Hz (e.g. 16000 / 48000). */
  readonly sampleRate: number;
  /** Number of samples per processed frame (e.g. 128 / 480). */
  readonly frameSize: number;
  /** RMS threshold in decibels above which a frame counts as speech. */
  readonly thresholdDb: number;
  /** Consecutive above-threshold frames required to declare speech start. */
  readonly speechFramesToStart: number;
  /** Consecutive below-threshold frames required to declare speech end. */
  readonly silenceFramesToEnd: number;
  /** Minimum utterance length (ms); shorter blips are ignored. */
  readonly minSpeechMs: number;
}

export type VadFrameEvent = "speech_start" | "speech_end";

export interface VadDetector {
  /**
   * Feed one stereo-mixed mono frame. `nowMs` is the current monotonic time
   * (caller supplies it so the detector stays pure / timer-free).
   */
  process(frame: Float32Array, nowMs: number): VadFrameEvent | null;
  /** True while the detector currently considers speech active. */
  readonly speechActive: boolean;
  /** Reset all internal counters (e.g. when the mic is re-opened). */
  reset(): void;
}

export const defaultVadConfig: VadConfig = {
  sampleRate: 16_000,
  frameSize: 480, // 30ms at 16kHz
  thresholdDb: -30,
  speechFramesToStart: 4, // ~120ms of speech to start
  silenceFramesToEnd: 12, // ~360ms of silence to end
  minSpeechMs: 180,
};

/** RMS of a mono frame in decibels (clamped to -inf when perfectly silent). */
export function frameRmsDb(frame: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < frame.length; i += 1) {
    const sample = frame[i];
    sum += sample * sample;
  }
  const rms = Math.sqrt(sum / frame.length);
  if (rms <= 0) {
    return -Infinity;
  }
  return 20 * Math.log10(rms);
}

/** Mix a stereo (or larger) interleaved buffer into a mono frame. */
export function mixToMono(
  interleaved: Float32Array,
  channels: number,
): Float32Array {
  const mono = new Float32Array(Math.floor(interleaved.length / channels));
  for (let i = 0; i < mono.length; i += 1) {
    let sum = 0;
    for (let c = 0; c < channels; c += 1) {
      sum += interleaved[i * channels + c] ?? 0;
    }
    mono[i] = sum / channels;
  }
  return mono;
}

export function createVadDetector(config: VadConfig = defaultVadConfig): VadDetector {
  let speechActive = false;
  let aboveCount = 0;
  let belowCount = 0;
  let speechStartMs = 0;
  const frameMs = (config.frameSize / config.sampleRate) * 1000;

  return {
    get speechActive() {
      return speechActive;
    },
    reset() {
      speechActive = false;
      aboveCount = 0;
      belowCount = 0;
      speechStartMs = 0;
    },
    process(frame: Float32Array, nowMs: number): VadFrameEvent | null {
      const db = frameRmsDb(frame);
      if (db >= config.thresholdDb) {
        aboveCount += 1;
        belowCount = 0;
        if (!speechActive && aboveCount >= config.speechFramesToStart) {
          speechActive = true;
          speechStartMs = nowMs;
          aboveCount = 0;
          return "speech_start";
        }
      } else {
        belowCount += 1;
        aboveCount = 0;
        if (speechActive) {
          if (belowCount >= config.silenceFramesToEnd) {
            const speechMs = nowMs - speechStartMs;
            speechActive = false;
            belowCount = 0;
            if (speechMs < config.minSpeechMs) {
              // A click / blip, not a real utterance — ignore it entirely.
              return null;
            }
            return "speech_end";
          }
        }
      }
      return null;
    },
  };
}