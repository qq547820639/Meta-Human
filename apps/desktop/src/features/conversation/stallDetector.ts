/**
 * Stall / freeze and frame-drop detection for the live avatar stream (Task 7).
 *
 * A live stream that freezes (the video `currentTime` stops advancing) is
 * effectively dead even though the `<video>` element reports no error event.
 * These pure helpers watch progress and frame timestamps so the presenter can
 * degrade instead of showing a frozen frame indefinitely.
 *
 * Both helpers are browser-API-free at the core and only use `setTimeout` for
 * the stall sampler, so they run predictably under Vitest with fake timers.
 */

export interface StallDetectorOptions {
  /** How long (ms) without observable progress before a stall is reported. */
  readonly stallThresholdMs: number;
  /** How often (ms) the sampler checks for progress. */
  readonly sampleIntervalMs: number;
}

export interface StallDetector {
  /**
   * Reports a progress sample. `videoCurrentTimeMs` is the media element's
   * current time; when it stops advancing, progress is considered frozen.
   */
  onProgress(nowMs: number, videoCurrentTimeMs: number): void;
  /** Stops the sampler and releases the timer. */
  cancel(): void;
}

/**
 * Creates a stall detector. `onStall` fires once per stall episode (after the
 * video time stops advancing for `stallThresholdMs`); any later progress
 * resets the detector so a new stall can be reported again.
 */
export function createStallDetector(
  { stallThresholdMs, sampleIntervalMs }: StallDetectorOptions,
  onStall: () => void,
): StallDetector {
  let lastProgressAt = 0;
  let lastVideoTime = -1;
  let stalled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function check(): void {
    timer = null;
    if (!stalled && Date.now() - lastProgressAt >= stallThresholdMs) {
      stalled = true;
      onStall();
    }
    timer = setTimeout(check, sampleIntervalMs);
  }

  return {
    onProgress(nowMs, videoCurrentTimeMs) {
      if (videoCurrentTimeMs !== lastVideoTime) {
        lastProgressAt = nowMs;
        lastVideoTime = videoCurrentTimeMs;
        stalled = false;
      }
      if (timer === null) {
        timer = setTimeout(check, sampleIntervalMs);
      }
    },
    cancel() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}

export interface FrameDropDetector {
  /**
   * Records a frame timestamp. Returns `true` when the gap from the previous
   * frame exceeds `maxGapMs` (a dropped frame / gap was detected), else `false`.
   */
  record(timestampMs: number): boolean;
}

/**
 * Creates a frame-drop detector that reports a drop whenever the gap between
 * two consecutive frame timestamps exceeds `maxGapMs`. The first recorded frame
 * never counts as a drop (there is no prior frame to compare against).
 */
export function createFrameDropDetector({
  maxGapMs,
}: {
  readonly maxGapMs: number;
}): FrameDropDetector {
  let lastFrameAt: number | null = null;
  return {
    record(timestampMs) {
      const dropped = lastFrameAt !== null && timestampMs - lastFrameAt > maxGapMs;
      lastFrameAt = timestampMs;
      return dropped;
    },
  };
}