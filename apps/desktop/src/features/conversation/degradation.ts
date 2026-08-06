/**
 * Presentation degradation ladder (Task 7).
 *
 * The digital human can be presented in several ways that degrade gracefully:
 * full video, audio-only (avatar voice without the video), a static portrait,
 * and finally plain text. This module is pure and decides:
 *
 *   - which presentation mode to use given what is currently ready and how far
 *     the session has degraded, and
 *   - how the degradation level escalates as the video / audio fail, and
 *   - whether enough time has passed to attempt recovery to a higher tier.
 */

export type PresentationModeChoice = "video" | "audio" | "static" | "text";

/** 0 = healthy video, 1 = audio-only, 2 = static portrait, 3 = text-only. */
export type DegradationLevel = 0 | 1 | 2 | 3;

export const MAX_DEGRADATION_LEVEL: DegradationLevel = 3;

export interface ChoosePresentationModeInput {
  readonly videoReady: boolean;
  readonly audioReady: boolean;
  readonly staticReady: boolean;
  readonly degradedLevel: DegradationLevel;
}

/**
 * Chooses the best presentation mode for the current degradation level:
 *
 *   - level 0 keeps the full video stream when it is ready;
 *   - level 1 degrades to audio-only (video is being dropped);
 *   - level 2 falls back to the static portrait;
 *   - level 3 becomes text-only.
 *
 * Within a level we still prefer the richest ready asset (e.g. at level 0 with
 * video not yet ready, audio is used instead of showing nothing).
 */
export function choosePresentationMode({
  videoReady,
  audioReady,
  staticReady,
  degradedLevel,
}: ChoosePresentationModeInput): PresentationModeChoice {
  if (videoReady && degradedLevel === 0) {
    return "video";
  }
  if (audioReady && degradedLevel <= 1) {
    return "audio";
  }
  if (staticReady && degradedLevel <= 2) {
    return "static";
  }
  return "text";
}

/**
 * Escalates the degradation level when the video stalls and/or the audio fails.
 * Each failure advances one tier; the result is capped at `MAX_DEGRADATION_LEVEL`.
 */
export function nextDegradationLevel(
  videoStalled: boolean,
  audioFailed: boolean,
  current: DegradationLevel,
): DegradationLevel {
  let next = current;
  if (videoStalled) {
    next += 1;
  }
  if (audioFailed) {
    next += 1;
  }
  return Math.min(next, MAX_DEGRADATION_LEVEL) as DegradationLevel;
}

/**
 * Whether recovery to a higher tier should be attempted. A session at level 0
 * has nothing to recover. Otherwise recovery is gated by a cooldown since the
 * last failure so we do not hot-loop retrying a broken presentation.
 */
export function shouldAttemptRecovery(
  level: DegradationLevel,
  lastFailureAt: number | null,
  cooldownMs: number,
  now: number,
): boolean {
  if (level === 0) {
    return false;
  }
  if (lastFailureAt === null) {
    return true;
  }
  return now - lastFailureAt >= cooldownMs;
}