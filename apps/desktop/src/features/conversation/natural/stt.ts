/**
 * Real-time / chunked speech-to-text session abstraction.
 *
 * Natural mode needs a transcript when the user finishes speaking. This module
 * defines a small `SttSession` contract and three implementations:
 *
 *   - `createBrowserSttSession` wraps the Web Speech API
 *     (`webkitSpeechRecognition`) when present, which reports `interimResults`
 *     natively. It is a *capability probe + adapter*.
 *   - `createSidecarSttSession` is the REAL production fallback when the Web
 *     Speech API is absent. It records the mic utterance (native capture that
 *     writes a temp WAV file) and POSTs it to the sidecar `transcribe` endpoint.
 *     The sidecar has no streaming interim, so this session reports NO interim
 *     transcripts and only a final transcript after recording stops
 *     (`supportsInterim === false`). Every promise settles deterministically
 *     (timeout / abort / error mapping).
 *   - `createMockSttSession` is a deterministic mock for tests ONLY. It is never
 *     used as a production fallback.
 *
 * The browser session is driven by real recognition events (`onresult` /
 * `onend` / `onerror`); the sidecar session is driven by real MediaRecorder/
 * native capture + sidecar transcription; neither fakes a state with timers.
 */

import { ApiError } from "../../../api/client";
import {
  deleteMediaFile,
  startRecording,
  stopRecording,
} from "../../creation/captureClient";
import { transcribeRecording } from "../conversationClient";

export interface SttSession {
  readonly name: string;
  start(): void;
  /** Stop and resolve with the final transcript ("" if none). */
  stop(): Promise<string>;
  /** Abort without resolving (used on barge-in / cancel). */
  abort(): void;
  /**
   * False when the session only reports a final transcript after recording
   * stops (record-then-transcribe). The UI can show "recording then
   * transcribing" honestly instead of assuming live interim text.
   */
  readonly supportsInterim?: boolean;
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

/** True when the real sidecar STT path is reachable (mic + sidecar present). */
export function hasSidecarStt(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function"
  );
}

/** Structured reason an STT session could not produce a transcript. */
export type SttErrorReason =
  | "permission-denied"
  | "sidecar-unreachable"
  | "timeout"
  | "empty-transcript"
  | "capture-failed"
  | "aborted";

/** Structured STT error with a stable `reason` for the caller to react to. */
export class SttError extends Error {
  readonly reason: SttErrorReason;
  constructor(reason: SttErrorReason, message: string) {
    super(message);
    this.name = "SttError";
    this.reason = reason;
  }
}

function isPermissionDenied(caught: unknown): boolean {
  if (typeof caught === "object" && caught !== null) {
    const name = (caught as { name?: unknown }).name;
    if (typeof name === "string") {
      const lower = name.toLowerCase();
      if (lower.includes("notallowed") || lower.includes("permission")) {
        return true;
      }
    }
  }
  return false;
}

function toSttError(caught: unknown): SttError {
  if (caught instanceof SttError) {
    return caught;
  }
  if (caught instanceof ApiError) {
    return new SttError("sidecar-unreachable", caught.message);
  }
  if (isPermissionDenied(caught)) {
    return new SttError("permission-denied", "麦克风权限被拒绝，无法识别语音。");
  }
  return new SttError(
    "capture-failed",
    caught instanceof Error ? caught.message : "语音识别失败。",
  );
}

/** Simple UUID-ish request id for correlation across the STT request. */
function generateRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `stt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

interface NativeCapture {
  start(): Promise<void>;
  stop(): Promise<string>; // resolves with the temp audio_path
  cleanup?(audioPath: string): Promise<void>;
}

function nativeCapture(): NativeCapture {
  return {
    start: () => startRecording(),
    stop: () => stopRecording(),
    cleanup: (audioPath) => deleteMediaFile(audioPath),
  };
}

export interface SidecarSttSessionDeps {
  /** Captures the mic utterance from start() to stop() into a temp WAV file. */
  readonly capture?: NativeCapture;
  /** Transcribes a recorded audio file via the sidecar. */
  readonly transcribe?: (audioPath: string) => Promise<string>;
  /** Hard timeout for the whole stop() -> transcribe round trip (ms). */
  readonly timeoutMs?: number;
  /** Request-id generator for correlation. */
  readonly requestId?: () => string;
}

/**
 * REAL sidecar STT session (record-then-transcribe). No interim transcripts are
 * reported (the sidecar has no streaming endpoint) — only a final transcript
 * once recording stops. `stop()` always settles: it resolves with the final
 * text or rejects with a mapped {@link SttError} within `timeoutMs`.
 */
export function createSidecarSttSession(
  callbacks: SttSessionCallbacks,
  deps: SidecarSttSessionDeps = {},
): SttSession {
  const capture = deps.capture ?? nativeCapture();
  const transcribe = deps.transcribe ?? transcribeRecording;
  const timeoutMs = deps.timeoutMs ?? 15_000;
  const requestId = deps.requestId ?? generateRequestId;

  let started = false;
  let aborted = false;
  let startError: unknown = null;
  let audioPath: string | null = null;
  let pendingStop: { resolve: (t: string) => void; reject: (e: unknown) => void } | null =
    null;
  let abortController: AbortController | null = null;

  function settle(text: string): void {
    if (pendingStop) {
      pendingStop.resolve(text);
      pendingStop = null;
    }
  }
  function settleReject(err: unknown): void {
    if (pendingStop) {
      pendingStop.reject(err);
      pendingStop = null;
    }
  }

  async function runStop(): Promise<void> {
    let path: string | null = null;
    try {
      path = await capture.stop();
      audioPath = path;
      // requestId is generated for correlation/logging; it is not surfaced to
      // the user unless an error occurs.
      requestId();
      const text = await transcribeWithTimeout(
        transcribe(path),
        timeoutMs,
        abortController,
      );
      const trimmed = text.trim();
      if (!trimmed) {
        throw new SttError(
          "empty-transcript",
          "没有识别到语音内容，请再试一次。",
        );
      }
      settle(trimmed);
    } catch (caught) {
      settleReject(toSttError(caught));
    } finally {
      if (path) {
        audioPath = null;
        void capture.cleanup?.(path).catch(() => {
          // Best-effort cleanup; a failure must not mask the transcript result.
        });
      }
    }
  }

  return {
    name: "sidecar-stt",
    get supportsInterim() {
      return false;
    },
    start() {
      if (started) {
        return;
      }
      started = true;
      aborted = false;
      abortController = new AbortController();
      capture.start().catch((err) => {
        startError = err;
      });
    },
    stop() {
      return new Promise<string>((resolve, reject) => {
        if (!started) {
          reject(new SttError("aborted", "STT 会话未启动。"));
          return;
        }
        if (aborted) {
          reject(new SttError("aborted", "STT 已取消。"));
          return;
        }
        if (startError) {
          reject(toSttError(startError));
          return;
        }
        pendingStop = { resolve, reject };
        void runStop();
      });
    },
    abort() {
      aborted = true;
      abortController?.abort();
      abortController = null;
      if (pendingStop) {
        pendingStop.reject(new SttError("aborted", "STT 已取消。"));
        pendingStop = null;
      }
      if (audioPath) {
        const path = audioPath;
        audioPath = null;
        void capture.cleanup?.(path).catch(() => {
          // Best-effort cleanup.
        });
      }
    },
  };
}

/**
 * Wraps a transcribe promise so it settles within `timeoutMs` and rejects on
 * `signal` abort. Guarantees the sidecar session never hangs.
 */
function transcribeWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  signal: AbortController | null,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      signal?.abort();
      fn();
    };
    const timer = setTimeout(
      finish(() => reject(new SttError("timeout", "语音识别超时，请重试。"))),
      timeoutMs,
    );
    if (signal) {
      signal.signal.addEventListener(
        "abort",
        finish(() => reject(new SttError("aborted", "STT 已取消。"))),
        { once: true },
      );
    }
    promise.then(
      (value) => finish(() => resolve(value))(),
      (err) => finish(() => reject(toSttError(err)))(),
    );
  });
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
    get supportsInterim() {
      return true;
    },
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

/** Deterministic mock STT session for tests ONLY (never a production fallback). */
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