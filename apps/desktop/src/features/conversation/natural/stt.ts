/**
 * Real-time / chunked speech-to-text session abstraction.
 *
 * Natural mode needs *interim* transcripts so the user can see and correct
 * what they said while it is being spoken, then a *final* transcript when the
 * utterance ends. This module defines a small `SttSession` contract and two
 * implementations:
 *
 *   - `createBrowserSttSession` wraps the Web Speech API
 *     (`webkitSpeechRecognition`) when present, which reports `interimResults`
 *     natively. It is a *capability probe + adapter*.
 *   - `createMockSttSession` is a deterministic mock for tests / hosts without
 *     a speech engine.
 *
 * The session is driven by real recognition events (`onresult` /
 * `onend` / `onerror`), never by fake timers.
 */

export interface SttSession {
  readonly name: string;
  start(): void;
  /** Stop and resolve with the final transcript ("" if none). */
  stop(): Promise<string>;
  /** Abort without resolving (used on barge-in / cancel). */
  abort(): void;
}

export interface SttSessionCallbacks {
  readonly onInterim?: (text: string) => void;
  readonly onError?: (message: string) => void;
}

export interface SttSessionFactory {
  (callbacks: SttSessionCallbacks): SttSession;
}

/** True when the host exposes a streaming speech-recognition API. */
export function hasBrowserStt(): boolean {
  return (
    typeof window !== "undefined" &&
    (("webkitSpeechRecognition" in window) as boolean ||
      ("SpeechRecognition" in window) as boolean)
  );
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((event: unknown) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

function resultText(event: unknown): { interim: string; final: string } {
  const ev = event as {
    resultIndex?: number;
    results?: ArrayLike<
      ArrayLike<{ transcript?: string }> & { isFinal?: boolean }
    >;
  };
  let interim = "";
  let final = "";
  const results = ev.results;
  if (!results) {
    return { interim: "", final: "" };
  }
  for (let i = 0; i < results.length; i += 1) {
    const alt = results[i];
    const text = alt?.[0]?.transcript ?? "";
    if (alt?.isFinal) {
      final += text;
    } else {
      interim += text;
    }
  }
  return { interim, final };
}

/** Browser adapter over the Web Speech API (interim + final). */
export function createBrowserSttSession(
  callbacks: SttSessionCallbacks,
  lang = "zh-CN",
): SttSession | null {
  const Ctor = (
    window as unknown as {
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
      SpeechRecognition?: new () => SpeechRecognitionLike;
    }
  ).webkitSpeechRecognition as
    | (new () => SpeechRecognitionLike)
    | undefined;
  if (!Ctor) {
    return null;
  }
  const recognition = new Ctor();
  recognition.lang = lang;
  recognition.interimResults = true;
  recognition.continuous = true;
  recognition.maxAlternatives = 1;

  let active = false;
  let resolveStop: ((text: string) => void) | null = null;
  let finalBuffer = "";
  let errored = false;

  recognition.onresult = (event) => {
    const { interim, final } = resultText(event);
    if (final) {
      finalBuffer += final;
    }
    if (interim) {
      callbacks.onInterim?.(finalBuffer + interim);
    }
  };
  recognition.onend = () => {
    active = false;
    resolveStop?.(finalBuffer);
    resolveStop = null;
  };
  recognition.onerror = (event) => {
    errored = true;
    callbacks.onError?.(event.error ?? "speech recognition error");
  };

  return {
    name: "browser-stt",
    start() {
      active = true;
      finalBuffer = "";
      errored = false;
      try {
        recognition.start();
      } catch {
        // Already running (e.g. a fast speech-end/start) — nothing to do.
      }
    },
    stop() {
      return new Promise<string>((resolve) => {
        if (!active) {
          resolve(finalBuffer);
          return;
        }
        resolveStop = resolve;
        setTimeout(() => {
          // The recognition engine may not fire `onend` promptly; if the
          // underlying engine is non-responsive, settle with what we have.
          // This is a timeout for the *engine*, not a fake state.
          if (resolveStop) {
            resolveStop(finalBuffer);
            resolveStop = null;
          }
        }, 1500);
        try {
          recognition.stop();
        } catch {
          resolve(finalBuffer);
        }
      });
    },
    abort() {
      active = false;
      finalBuffer = "";
      resolveStop?.(finalBuffer);
      resolveStop = null;
      try {
        recognition.abort();
      } catch {
        // ignore
      }
    },
  };
}

/** Deterministic mock STT session for tests / hosts without speech engine. */
export function createMockSttSession(
  callbacks: SttSessionCallbacks,
): SttSession & {
  readonly emitInterim: (text: string) => void;
  readonly emitFinal: (text: string) => void;
  readonly emitError: (message: string) => void;
} {
  let started = false;
  let finalText = "";
  let resolveStop: ((text: string) => void) | null = null;
  const settle = (text: string) => {
    finalText = text;
    started = false;
    if (resolveStop) {
      resolveStop(text);
      resolveStop = null;
    }
  };
  return {
    name: "mock-stt",
    start() {
      started = true;
      finalText = "";
    },
    stop() {
      return new Promise<string>((resolve) => {
        if (!started) {
          resolve(finalText);
          return;
        }
        resolveStop = resolve;
      });
    },
    abort() {
      started = false;
      if (resolveStop) {
        resolveStop(finalText);
        resolveStop = null;
      }
    },
    emitInterim: (text) => {
      if (started) {
        callbacks.onInterim?.(text);
      }
    },
    emitFinal: (text) => {
      if (started) {
        callbacks.onInterim?.(text);
        settle(text);
      }
    },
    emitError: (message) => callbacks.onError?.(message),
  };
}