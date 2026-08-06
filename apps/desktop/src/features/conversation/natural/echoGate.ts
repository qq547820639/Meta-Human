/**
 * Playback-aware echo gate for the natural-conversation engine.
 *
 * When the assistant's TTS is playing through speakers, the microphone can
 * pick up the assistant's own voice and mistake it for a new user utterance,
 * causing a spurious barge-in. This pure helper decides whether an incoming
 * VAD `speech_start` event is likely echo (suppressed) or a real user
 * utterance that must barge in (passed through).
 *
 * Design:
 *   - It NEVER permanently disables barge-in. Barge-in is only suppressed for
 *     a short window right after playback begins — the classic echo burst —
 *     and only when the platform does NOT provide OS/hardware echo
 *     cancellation (AEC). When AEC is available we trust it and pass everything
 *     through so the user can interrupt freely.
 *   - A speech-start right after playback began (no AEC) is suppressed as a
 *     suspected echo burst. If the user keeps talking, the very next
 *     speech-start (within a short sustain grace) is passed through so an
 *     ongoing real utterance still interrupts.
 *   - Outside the echo window every speech-start passes through.
 */
export type EchoVerdict = "suppress" | "pass";

export interface EchoGate {
  /** True while the assistant is audibly playing (playback in progress). */
  readonly audible: boolean;
  /** True when the platform provides echo cancellation (AEC). */
  readonly echoCancellation: boolean;
  /** Mark playback as started (assistant became audible). */
  onAssistantStarted(nowMs: number): void;
  /** Mark playback as ended (assistant no longer audible). */
  onAssistantEnded(): void;
  /**
   * Decide whether a VAD `speech_start` at `nowMs` is echo (suppress) or a
   * real user barge-in (pass).
   */
  classifySpeechStart(nowMs: number): EchoVerdict;
  /** VAD speech-starts seen while the assistant was audible (potential false triggers). */
  readonly vadFalseTriggerCount: number;
  /** How many of those were suppressed as suspected echo. */
  readonly echoSuppressedCount: number;
  /** How many passed through as a real user barge-in. */
  readonly validBargeInCount: number;
}

/**
 * Frame-level input suppression state used by {@link shouldAcceptMicFrame}.
 *
 * This complements {@link EchoGate.classifySpeechStart}: the gate classifies a
 * VAD *event* (a speech-start) as echo or barge-in, while `shouldAcceptMicFrame`
 * decides at the raw PCM-frame level whether the microphone should be trusted at
 * all. While the assistant's TTS is audibly playing and the platform provides no
 * OS/hardware echo cancellation (AEC), the assistant's own voice would otherwise
 * be re-recognized as a fresh user utterance — so those frames are suppressed.
 */
export interface MicFrameSuppressionState {
  /** True while assistant TTS audio is audibly playing. */
  readonly isTtsPlaying: boolean;
  /** True when the platform provides echo cancellation (AEC). */
  readonly echoCancellation: boolean;
  /**
   * Milliseconds elapsed since TTS playback ended. Use `Infinity` when TTS has
   * never played (frames are accepted immediately).
   */
  readonly msSinceTtsEnded: number;
  /**
   * Cooldown (ms) after playback ends during which mic frames are still
   * suppressed, so the tail-end of the just-finished audio is not mistaken for
   * a new utterance. Default 150.
   */
  readonly postTtsCooldownMs?: number;
}

/**
 * Decide whether a raw microphone frame should be accepted as real user input.
 *
 *   - While TTS is playing: accept only when AEC is available (the OS already
 *     removes the assistant's own voice). Without AEC, frames are suppressed so
 *     the assistant's voice is never re-recognized.
 *   - After TTS stops: accept again, but only after the configured cooldown so
 *     the audio tail is not interpreted as speech.
 *
 * Pure and timer-free — the caller supplies the elapsed time.
 */
export function shouldAcceptMicFrame(state: MicFrameSuppressionState): boolean {
  const cooldown = state.postTtsCooldownMs ?? 150;
  if (state.isTtsPlaying) {
    return state.echoCancellation === true;
  }
  return state.msSinceTtsEnded >= cooldown;
}

export interface EchoGateOptions {
  /** ms after playback begins during which a burst is treated as echo. */
  readonly shortBurstWindowMs?: number;
  /** ms after a suppressed burst within which a continuation passes. */
  readonly sustainGraceMs?: number;
  /**
   * Whether OS/hardware echo cancellation (AEC) is available. May be a boolean
   * or a getter so the value can change after the gate is created (the natural
   * engine is built lazily, before the capability probe resolves).
   */
  readonly echoCancellation?: boolean | (() => boolean);
}

export function createEchoGate(options: EchoGateOptions = {}): EchoGate {
  const shortBurstWindowMs = options.shortBurstWindowMs ?? 400;
  const sustainGraceMs = options.sustainGraceMs ?? 300;
  const readEchoCancellation = (): boolean =>
    typeof options.echoCancellation === "function"
      ? options.echoCancellation()
      : (options.echoCancellation ?? false);

  let audible = false;
  let playbackStartMs = 0;
  let lastSuppressedAt = 0;
  let vadFalseTriggerCount = 0;
  let echoSuppressedCount = 0;
  let validBargeInCount = 0;

  return {
    get audible() {
      return audible;
    },
    get echoCancellation() {
      return readEchoCancellation();
    },
    get vadFalseTriggerCount() {
      return vadFalseTriggerCount;
    },
    get echoSuppressedCount() {
      return echoSuppressedCount;
    },
    get validBargeInCount() {
      return validBargeInCount;
    },
    onAssistantStarted(nowMs) {
      audible = true;
      playbackStartMs = nowMs;
      lastSuppressedAt = 0;
    },
    onAssistantEnded() {
      audible = false;
    },
    classifySpeechStart(nowMs) {
      if (!audible) {
        return "pass";
      }
      // With real AEC the OS already removes the assistant's own voice, so we
      // never add a suppression window on top of it.
      if (readEchoCancellation()) {
        vadFalseTriggerCount += 1;
        validBargeInCount += 1;
        return "pass";
      }
      const sincePlayback = nowMs - playbackStartMs;
      // An ongoing utterance that survived a suppressed echo burst (a second
      // speech-start within grace) is real user speech -> allow it to barge in
      // even while still inside the short-burst window.
      if (lastSuppressedAt > 0 && nowMs - lastSuppressedAt <= sustainGraceMs) {
        vadFalseTriggerCount += 1;
        validBargeInCount += 1;
        return "pass";
      }
      if (sincePlayback <= shortBurstWindowMs) {
        // A burst right after playback began is most likely the assistant's
        // own voice. Remember it so a continuation is treated as real speech.
        lastSuppressedAt = nowMs;
        vadFalseTriggerCount += 1;
        echoSuppressedCount += 1;
        return "suppress";
      }
      // Outside the echo window -> real user barge-in.
      vadFalseTriggerCount += 1;
      validBargeInCount += 1;
      return "pass";
    },
  };
}