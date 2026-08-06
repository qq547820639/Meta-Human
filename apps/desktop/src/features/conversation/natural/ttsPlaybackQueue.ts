/**
 * Strictly-ordered TTS playback queue for the natural conversation pipeline.
 *
 * The sidecar streams REAL TTS audio chunks over SSE (`audio` events). This
 * queue guarantees those chunks play strictly in order with no overlap: only
 * one audio element is ever playing at a time, later chunks are pre-buffered,
 * and the next chunk never starts until the previous one finished (or failed).
 *
 * It provides backpressure (a bounded pending queue; the oldest chunk is
 * dropped when the buffer is full) and can be cleared on interrupt so a stale
 * chunk never plays across a turn boundary.
 *
 * `onDrained` fires only when the queue has emptied after playing — so the
 * engine can fire `ASSISTANT_ENDED` only after every chunk of the current turn
 * has actually played. No chunk is ever faked or synthesized here; the queue
 * only plays audio it was given.
 */

export interface TtsChunkAudio {
  play(): Promise<void>;
  pause(): void;
  load(): void;
  removeAttribute(name: string): void;
  setAttribute(name: string, value: string): void;
  onended: (() => void) | null;
  onerror: (() => void) | null;
}

export interface TtsPlaybackQueueOptions {
  /** Max pending (not-yet-played) chunks buffered before backpressure drops the OLDEST. */
  readonly maxQueueLength?: number;
  /** Called when a chunk fails to play (it is skipped; the queue continues). */
  readonly onChunkError?: (error: unknown) => void;
  /** Called when the queue drains (all chunks in the current turn played). */
  readonly onDrained?: () => void;
  /** Injectable audio-element factory (tests inject a fake). */
  readonly createAudio?: () => TtsChunkAudio;
}

export interface TtsPlaybackQueue {
  /** Enqueue a real TTS audio chunk (base64 WAV) for ordered playback. */
  enqueue(audioBase64: string): void;
  /** Stop the current chunk and drop all pending chunks (interrupt/cancel). */
  clear(): void;
  /** Number of chunks buffered but not yet played. */
  readonly pendingCount: number;
  /** True while a chunk is currently playing. */
  readonly playing: boolean;
}

function dataUrl(audioBase64: string): string {
  return `data:audio/wav;base64,${audioBase64}`;
}

export function createTtsPlaybackQueue(
  options: TtsPlaybackQueueOptions = {},
): TtsPlaybackQueue {
  const maxQueueLength = options.maxQueueLength ?? 8;
  const createAudio =
    options.createAudio ?? (() => new Audio() as unknown as TtsChunkAudio);

  let pending: string[] = [];
  let current: TtsChunkAudio | null = null;
  let disposed = false;

  function finishCurrent(): void {
    const node = current;
    current = null;
    if (node) {
      node.onended = null;
      node.onerror = null;
      node.pause();
      node.removeAttribute("src");
      node.load();
    }
  }

  function playNext(): void {
    if (disposed) {
      pending = [];
      return;
    }
    if (current) {
      return; // already playing; playNext is only called when idle
    }
    const next = pending.shift();
    if (next === undefined) {
      // Queue drained — every chunk of the current turn has played.
      options.onDrained?.();
      return;
    }
    const node = createAudio();
    current = node;
    node.onended = () => {
      finishCurrent();
      playNext();
    };
    node.onerror = () => {
      options.onChunkError?.(new Error("tts-chunk-playback-failed"));
      finishCurrent();
      playNext();
    };
    node.setAttribute("src", dataUrl(next));
    node.load();
    void node.play().catch((error) => {
      // Autoplay may be blocked; skip the chunk and continue with the queue.
      options.onChunkError?.(error);
      finishCurrent();
      playNext();
    });
  }

  return {
    get pendingCount() {
      return pending.length;
    },
    get playing() {
      return current !== null;
    },
    enqueue(audioBase64) {
      if (disposed) {
        return;
      }
      if (pending.length >= maxQueueLength) {
        // Backpressure: drop the OLDEST pending chunk to bound memory and keep
        // latency low (trailing/older audio is less important than fresh).
        pending.shift();
      }
      pending.push(audioBase64);
      if (!current) {
        playNext();
      }
    },
    clear() {
      pending = [];
      finishCurrent();
    },
  };
}