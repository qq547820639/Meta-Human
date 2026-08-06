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
  /** Called when a chunk fails to play or a sentence fails to synthesize (it is skipped). */
  readonly onChunkError?: (error: unknown) => void;
  /** Called when the queue drains (all chunks in the current turn played). */
  readonly onDrained?: () => void;
  /** Injectable audio-element factory (tests inject a fake). */
  readonly createAudio?: () => TtsChunkAudio;
}

export interface TtsPlaybackQueue {
  /** Enqueue a real TTS audio chunk (base64 WAV) for ordered playback. */
  enqueue(audioBase64: string): void;
  /**
   * Enqueue a sentence whose audio is synthesized on demand (progressive TTS).
   * Synthesis runs only when it is this sentence's turn; if it rejects, the
   * sentence is skipped and the queue continues with the next one (degraded).
   */
  enqueueSentence(sentence: string, synth: () => Promise<string>): void;
  /** Stop the current chunk and drop all pending chunks (interrupt/cancel). */
  clear(): void;
  /** Number of chunks buffered but not yet played. */
  readonly pendingCount: number;
  /** True while a chunk is currently playing. */
  readonly playing: boolean;
  /** True once at least one item in the current turn failed (synthesis or playback). */
  readonly degraded: boolean;
  /** True when EVERY item in the current turn failed (text-only fallback needed). */
  readonly fullyDegraded: boolean;
}

/** A queued unit: either pre-synthesized audio or a lazily-synthesized sentence. */
interface QueueItem {
  readonly audio?: string;
  readonly synth?: () => Promise<string>;
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

  let pending: QueueItem[] = [];
  let current: TtsChunkAudio | null = null;
  let disposed = false;
  let failedCount = 0;
  let totalCount = 0;
  let degraded = false;
  let fullyDegraded = false;
  /** True while a lazily-synthesized sentence is being awaited (queue is busy). */
  let processing = false;
  /** Incremented on clear() so a stale in-flight synthesis resolution is dropped. */
  let turnId = 0;
  /** True once the queue has fully drained (a fresh turn may begin). */
  let queueDrained = true;

  function resetTurnStats(): void {
    failedCount = 0;
    totalCount = 0;
    degraded = false;
    fullyDegraded = false;
  }

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

  function playAudioUnit(audioBase64: string): void {
    const node = createAudio();
    current = node;
    node.onended = () => {
      finishCurrent();
      playNext();
    };
    node.onerror = () => {
      options.onChunkError?.(new Error("tts-chunk-playback-failed"));
      failedCount += 1;
      degraded = true;
      finishCurrent();
      playNext();
    };
    node.setAttribute("src", dataUrl(audioBase64));
    node.load();
    void node.play().catch((error) => {
      // Autoplay may be blocked; skip the chunk and continue with the queue.
      options.onChunkError?.(error);
      failedCount += 1;
      degraded = true;
      finishCurrent();
      playNext();
    });
  }

  function playNext(): void {
    if (disposed) {
      pending = [];
      return;
    }
    if (current || processing) {
      return; // a chunk is playing or a sentence is being synthesized
    }
    const next = pending.shift();
    if (next === undefined) {
      // Queue drained — every item of the current turn has been handled.
      queueDrained = true;
      if (totalCount > 0) {
        fullyDegraded = failedCount === totalCount;
      }
      options.onDrained?.();
      return;
    }
    if (next.synth) {
      // Progressive TTS: synthesize this sentence only now. On failure, skip it
      // and continue to the next sentence rather than stalling the queue.
      const capturedTurn = turnId;
      processing = true;
      next.synth().then(
        (audioBase64) => {
          processing = false;
          if (capturedTurn === turnId) {
            playAudioUnit(audioBase64);
          }
        },
        (error) => {
          processing = false;
          if (capturedTurn !== turnId) {
            return; // cleared while synthesizing — drop the stale failure
          }
          options.onChunkError?.(error);
          failedCount += 1;
          degraded = true;
          playNext();
        },
      );
    } else if (next.audio !== undefined) {
      playAudioUnit(next.audio);
    }
  }

  return {
    get pendingCount() {
      return pending.length;
    },
    get playing() {
      return current !== null;
    },
    get degraded() {
      return degraded;
    },
    get fullyDegraded() {
      return fullyDegraded;
    },
    enqueue(audioBase64) {
      if (disposed) {
        return;
      }
      if (queueDrained) {
        // A fresh turn begins (the previous one fully drained).
        resetTurnStats();
        queueDrained = false;
      }
      totalCount += 1;
      if (pending.length >= maxQueueLength) {
        // Backpressure: drop the OLDEST pending chunk to bound memory and keep
        // latency low (trailing/older audio is less important than fresh). A
        // dropped item is never handled, so it is not counted toward degradation.
        pending.shift();
        totalCount -= 1;
      }
      pending.push({ audio: audioBase64 });
      if (!current) {
        playNext();
      }
    },
    enqueueSentence(sentence, synth) {
      if (disposed) {
        return;
      }
      if (queueDrained) {
        resetTurnStats();
        queueDrained = false;
      }
      totalCount += 1;
      if (pending.length >= maxQueueLength) {
        pending.shift();
        totalCount -= 1;
      }
      pending.push({ synth });
      if (!current) {
        playNext();
      }
    },
    clear() {
      pending = [];
      // Invalidate any in-flight synthesis so its resolution is dropped.
      turnId += 1;
      processing = false;
      queueDrained = true;
      finishCurrent();
      resetTurnStats();
    },
  };
}