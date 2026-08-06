/**
 * Audio/video (AV) time-sync primitives (Task 7).
 *
 * The live avatar stream carries two independent clocks — the audio clock
 * (playback position of synthesized speech) and the video clock (the media
 * element's `currentTime`). The digital human is presented well only when the
 * two stay aligned. This module is pure and testable: it computes the absolute
 * sync error between two clocks and maintains a running tracker that reports
 * the p95 error over collected samples so the presenter can decide whether to
 * correct drift or degrade.
 */

export interface AvSyncError {
  /** Absolute error between the two clocks, in ms. */
  readonly errorMs: number;
  /** True when `errorMs` is within the tolerance window. */
  readonly withinTolerance: boolean;
}

/**
 * Computes the absolute drift between the audio and video clocks and whether
 * that drift is within an acceptable tolerance. A negative/positive sign is
 * intentionally dropped — the presenter only cares about the magnitude.
 */
export function computeAvSyncErrorMs(
  audioClockMs: number,
  videoClockMs: number,
  toleranceMs: number,
): AvSyncError {
  const errorMs = Math.abs(audioClockMs - videoClockMs);
  return { errorMs, withinTolerance: errorMs <= toleranceMs };
}

/**
 * Running AV-sync tracker. Records samples (each an absolute error) and reports
 * the p95 percentile so occasional jitter does not skew the decision. Bounded
 * so memory stays flat over a long session.
 */
export class AvSyncTracker {
  private readonly samples: number[] = [];
  private readonly maxSamples: number;

  constructor(maxSamples = 1000) {
    this.maxSamples = maxSamples;
  }

  /** Records one AV-sync sample from the two clocks. */
  record(audioClockMs: number, videoClockMs: number): void {
    this.samples.push(Math.abs(audioClockMs - videoClockMs));
    if (this.samples.length > this.maxSamples) {
      this.samples.shift();
    }
  }

  /** Number of recorded samples so far. */
  count(): number {
    return this.samples.length;
  }

  /**
   * The 95th-percentile sync error in ms, or `null` when no samples exist.
   * Uses the nearest-rank method over a sorted copy of the samples.
   */
  p95(): number | null {
    if (this.samples.length === 0) {
      return null;
    }
    const sorted = [...this.samples].sort((a, b) => a - b);
    const rank = Math.min(
      sorted.length - 1,
      Math.max(0, Math.ceil(sorted.length * 0.95) - 1),
    );
    return sorted[rank];
  }

  /** Clears all recorded samples. */
  clear(): void {
    this.samples.length = 0;
  }
}