/**
 * First-frame timeout for the live avatar stream (Task 7).
 *
 * A live stream that never produces its first frame (e.g. the upstream encoder
 * is stuck) should not leave the user staring at a black video element forever.
 * This pure helper arms a timer while the stream is `loading` and reports
 * `onTimeout` if the stream never reaches `ready`. Marking `ready` (or calling
 * `cancel`) disarms the timer so a healthy stream never times out.
 */

export interface FirstFrameTimeout {
  /** Updates the stream readiness; `ready` disarms the timeout. */
  noteState(state: "loading" | "ready"): void;
  /** Disarms the timeout and releases the timer. */
  cancel(): void;
}

/**
 * Creates a first-frame timeout guard. While in the `loading` state a timer is
 * armed for `timeoutMs`; if the state is not marked `ready` before it fires,
 * `onTimeout` is invoked. Marking `ready` or calling `cancel` prevents firing.
 */
export function createFirstFrameTimeout({
  timeoutMs,
  onTimeout,
}: {
  readonly timeoutMs: number;
  readonly onTimeout: () => void;
}): FirstFrameTimeout {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let ready = false;

  function clearTimer(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function arm(): void {
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      if (!ready) {
        onTimeout();
      }
    }, timeoutMs);
  }

  return {
    noteState(state) {
      if (state === "ready") {
        ready = true;
        clearTimer();
      } else {
        ready = false;
        arm();
      }
    },
    cancel() {
      clearTimer();
    },
  };
}