/**
 * Streaming LLM → TTS sentence/flush chunker.
 *
 * TTS engines produce much better audio when fed stable, complete sentences
 * rather than arbitrary token fragments. The reply streamer emits raw text
 * tokens as they arrive; this pure helper buffers them and flushes only when a
 * stable semantic boundary is reached — a sentence terminated by Chinese or
 * English punctuation (。！？.!?) or a newline — so speech can start before the
 * full reply is generated.
 *
 * It is deliberately pure and timer-free: the caller drives it with real text
 * tokens and calls {@link finish} when the stream ends. An incomplete trailing
 * fragment is ALWAYS held in the buffer (never dropped) and is flushed by
 * `finish()`.
 */
export interface ReplyChunker {
  /** Append one text token to the buffer, flushing any complete sentences. */
  push(text: string): void;
  /** Flush whatever incomplete fragment remains (end of stream). */
  finish(): void;
  /** The currently buffered, not-yet-complete trailing fragment. */
  readonly pending: string;
  /**
   * Barge-in: capture the partially-streamed text so it can be resumed later
   * rather than discarded. Clears the live buffer (a new turn must not inherit
   * stale text) and returns the preserved fragment.
   */
  interrupt(): ReplyChunkerSnapshot;
  /**
   * Resume an interrupted reply: restore a previously preserved fragment so
   * subsequent {@link push} calls continue appending to it.
   */
  resume(snapshot: ReplyChunkerSnapshot): void;
}

/** A preserved partial reply captured by {@link ReplyChunker.interrupt}. */
export interface ReplyChunkerSnapshot {
  /** The partial text streamed before the interrupt. */
  readonly preservedText: string;
  /** Marks that this snapshot came from an interrupt (vs. a normal pause). */
  readonly wasInterrupted: boolean;
}

/** Characters that terminate a sentence / stable chunk. */
function isBoundary(ch: string): boolean {
  return (
    ch === "。" ||
    ch === "！" ||
    ch === "？" ||
    ch === "!" ||
    ch === "?" ||
    ch === "\n"
  );
}

/**
 * Index of the first sentence boundary in `s`, or -1. A run of periods
 * ("…" / "...") is consumed as a single boundary so ellipses are not torn
 * into multiple empty sentences.
 */
function firstBoundaryIndex(s: string): number {
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (isBoundary(ch)) {
      return i;
    }
    if (ch === ".") {
      while (i + 1 < s.length && s[i + 1] === ".") {
        i += 1;
      }
      return i;
    }
  }
  return -1;
}

export function createReplyChunker(
  onSentence: (sentence: string) => void,
): ReplyChunker {
  let buffer = "";

  /** Emit a flushed unit, trimming inter-sentence leading whitespace. */
  function emit(sentence: string): void {
    const clean = sentence.replace(/^\s+/, "");
    if (clean) {
      onSentence(clean);
    }
  }

  function flushComplete(): void {
    while (buffer.length > 0) {
      const idx = firstBoundaryIndex(buffer);
      if (idx === -1) {
        return;
      }
      const sentence = buffer.slice(0, idx + 1);
      buffer = buffer.slice(idx + 1);
      emit(sentence);
    }
  }

  return {
    get pending() {
      return buffer;
    },
    push(text) {
      if (!text) {
        return;
      }
      buffer += text;
      flushComplete();
    },
    finish() {
      if (buffer) {
        const tail = buffer;
        buffer = "";
        emit(tail);
      }
    },
    interrupt() {
      const snapshot: ReplyChunkerSnapshot = {
        preservedText: buffer,
        wasInterrupted: true,
      };
      // Clear the live buffer so a fresh turn does not inherit stale text; the
      // caller can restore it via resume() to continue the same reply.
      buffer = "";
      return snapshot;
    },
    resume(snapshot) {
      if (snapshot && snapshot.preservedText) {
        buffer = snapshot.preservedText;
      }
    },
  };
}