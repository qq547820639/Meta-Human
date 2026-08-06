import { useEffect, useRef, useState } from "react";

import { stopGenerating, streamConversationReply } from "./conversationClient";
import type { ConversationMetrics } from "./conversationMetrics";
import type { ConversationUiAction } from "./conversationStateMachine";
import type { ChatMessage, ChatError } from "./conversationModel";
import {
  createNaturalConversationEngine,
  type NaturalConversationHandle,
  type NaturalReplyStreamer,
} from "./natural/naturalConversationCore";
import {
  initialNaturalConversationState,
  isNaturalActive,
  naturalStatusLabel,
  type NaturalConversationState,
  type NaturalInputMode,
} from "./natural/naturalConversationStateMachine";
import {
  createBrowserSttSession,
  createSidecarSttSession,
  hasBrowserStt,
  hasSidecarStt,
  type SttSessionFactory,
} from "./natural/stt";
import {
  createTtsPlaybackQueue,
  type TtsPlaybackQueue,
} from "./natural/ttsPlaybackQueue";
import {
  createBrowserVadAdapter,
  noMicCapabilities,
  probeMicCapabilities,
  type MicCapabilities,
  type VadAdapter,
  VadStartError,
} from "./natural/vadAdapter";

export interface UseNaturalConversationProps {
  readonly humanId?: string | null;
  readonly getConversationId: () => string | null;
  readonly setMessages: (updater: (m: ChatMessage[]) => ChatMessage[]) => void;
  readonly setQuery: (query: string) => void;
  readonly setError: (error: ChatError | null) => void;
  readonly onMetrics: (metrics: Partial<ConversationMetrics>) => void;
  readonly dispatch: React.Dispatch<ConversationUiAction>;
  /** Injectable for tests / hosts without a speech engine. */
  readonly sttFactory?: SttSessionFactory;
  /** Injectable for tests (mock VAD). */
  readonly vadFactory?: () => VadAdapter;
  /** Injectable for tests (mock reply stream). */
  readonly streamReplyOverride?: NaturalReplyStreamer;
}

export interface UseNaturalConversationResult {
  readonly naturalState: NaturalConversationState;
  readonly naturalActive: boolean;
  readonly naturalStatus: string;
  readonly naturalTranscript: string;
  readonly transcriptFinal: boolean;
  readonly naturalMode: NaturalInputMode;
  readonly micCapabilities: MicCapabilities;
  readonly naturalSttAvailable: boolean;
  /** Recommended default input mode from real device capability probing. */
  readonly recommendedMode: NaturalInputMode;
  /** True when the browser rejected microphone permission (real VAD error). */
  readonly micDenied: boolean;
  /** Human-readable reason for the permission denial, if any. */
  readonly micDeniedReason: string | null;
  /** The sentence currently being spoken (from the reply chunker), if any. */
  readonly naturalSentence: string;
  enableNatural: (mode: NaturalInputMode) => Promise<void>;
  disableNatural: () => Promise<void>;
  setNaturalMode: (mode: NaturalInputMode) => void;
  retryNatural: () => Promise<void>;
  onTranscriptEdit: (text: string) => void;
  onTranscriptConfirm: () => void;
  interruptNatural: () => void;
  onAssistantAudioEnded: () => void;
}

/**
 * React glue around {@link createNaturalConversationEngine}. It owns the real
 * browser VAD adapter + STT factory + the SSE reply streamer + a transient
 * <audio> element for assistant playback, and mirrors the engine's state into
 * React so the workspace can render the listening / thinking / speaking /
 * reconnecting / interrupted indicators and the editable interim transcript.
 */
export function useNaturalConversation({
  humanId,
  getConversationId,
  setMessages,
  setQuery,
  setError,
  onMetrics,
  dispatch,
  sttFactory,
  vadFactory,
  streamReplyOverride,
}: UseNaturalConversationProps): UseNaturalConversationResult {
  const [naturalState, setNaturalState] = useState<NaturalConversationState>(
    initialNaturalConversationState,
  );
  const [micCapabilities, setMicCapabilities] = useState<MicCapabilities>(
    noMicCapabilities,
  );
  const [naturalSentence, setNaturalSentence] = useState("");
  const [micDenied, setMicDenied] = useState(false);
  const [micDeniedReason, setMicDeniedReason] = useState<string | null>(null);

  const engineRef = useRef<NaturalConversationHandle | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ttsQueueRef = useRef<TtsPlaybackQueue | null>(null);
  const humanIdRef = useRef<string | null | undefined>(humanId);
  const micCapabilitiesRef = useRef(micCapabilities);
  micCapabilitiesRef.current = micCapabilities;

  // Latest-callback refs so the engine always reads fresh values/actions.
  const getConversationIdRef = useRef(getConversationId);
  const setMessagesRef = useRef(setMessages);
  const setQueryRef = useRef(setQuery);
  const setErrorRef = useRef(setError);
  const onMetricsRef = useRef(onMetrics);
  const dispatchRef = useRef(dispatch);
  getConversationIdRef.current = getConversationId;
  setMessagesRef.current = setMessages;
  setQueryRef.current = setQuery;
  setErrorRef.current = setError;
  onMetricsRef.current = onMetrics;
  dispatchRef.current = dispatch;

  // Probe mic DSP capabilities once when the human is selected.
  useEffect(() => {
    void probeMicCapabilities().then(setMicCapabilities).catch(() => {
      setMicCapabilities(noMicCapabilities);
    });
  }, [humanId]);

  // When the selected digital human changes, stop the natural engine (and any
  // audio / VAD) so stale voice never crosses the human boundary.
  useEffect(() => {
    if (humanIdRef.current === humanId) {
      return;
    }
    humanIdRef.current = humanId;
    void engineRef.current?.disable();
    // `disable` is stable behavior (reads refs + engine); it must not be a dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [humanId]);

  // Build the engine lazily (once per mount). The strict-order TTS queue and
  // the engine reference each other, so create both in the same block: the
  // queue is only ever used inside `playAudio`/`stopAudio`, which run during a
  // reply — always after both are assigned.
  if (engineRef.current === null) {
    let ttsQueue: TtsPlaybackQueue | null = null;
    const engine = createNaturalConversationEngine({
      vad: vadFactory ? vadFactory() : createBrowserVadAdapter(),
      sttFactory:
        sttFactory ??
        ((callbacks) =>
          createBrowserSttSession(callbacks) ?? createSidecarSttSession(callbacks)),
      streamReply: streamReplyOverride ?? buildStreamReply(),
      cancelGeneration: (generationId) => stopGenerating(generationId),
      playAudio: (audioBase64) => {
        // Real sidecar TTS audio is enqueued and played strictly in order; the
        // queue fires ASSISTANT_ENDED (via onDrained) once every chunk played.
        ttsQueue?.enqueue(audioBase64);
      },
      stopAudio: () => {
        // Interrupt/cancel: stop the current chunk and drop all pending ones.
        ttsQueue?.clear();
        const node = audioRef.current;
        audioRef.current = null;
        if (node) {
          node.pause();
          node.removeAttribute("src");
          node.load();
        }
      },
      stopAvatar: () => {
        const video = document.querySelector<HTMLVideoElement>(
          ".conversation-avatar-stream",
        );
        if (video) {
          video.pause();
          video.removeAttribute("src");
          video.load();
        }
      },
      getConversationId: () => getConversationIdRef.current(),
      onReplyDelivered: (query, text) => {
        setErrorRef.current(null);
        setQueryRef.current("");
        setMessagesRef.current((current) => [
          ...current,
          {
            id: nextIdLocal(),
            role: "user",
            text: query,
            createdAt: new Date().toISOString(),
          },
          {
            id: nextIdLocal(),
            role: "assistant",
            text,
            createdAt: new Date().toISOString(),
          },
        ]);
      },
      onTtsSentence: (sentence) => setNaturalSentence(sentence),
      echoCancellation: () => micCapabilitiesRef.current.echoCancellation,
      onMetrics: (m) => onMetricsRef.current(m),
      onStateChange: setNaturalState,
    });
    engineRef.current = engine;
    ttsQueue = createTtsPlaybackQueue({
      onDrained: () => engine.onAssistantAudioEnded(),
      onChunkError: () => {
        // A chunk failed to play — skip it and let the queue continue. The
        // engine still treats the turn as speaking until the queue drains.
      },
    });
    ttsQueueRef.current = ttsQueue;
  }

  const naturalSttAvailable =
    hasBrowserStt() || hasSidecarStt() || !!sttFactory;

  // Recommended default input mode from real device capability probing: no mic
  // capability -> plain text; mic but no STT -> hold-to-talk; otherwise natural.
  const recommendedMode: NaturalInputMode = !micCapabilities.getUserMedia
    ? "text_only"
    : naturalSttAvailable
      ? "natural"
      : "push_to_talk";

  // "正在生成声音" (TTS voice being generated) is surfaced only from a real
  // event: the reply chunker flushed a sentence to the TTS queue while the
  // phase is still `thinking` (i.e. audio has not started playing yet). None of
  // these labels are faked with timers.
  const naturalStatus =
    naturalState.phase === "thinking" && naturalSentence.trim().length > 0
      ? "正在生成声音…"
      : naturalStatusLabel(naturalState);

  return {
    naturalState,
    naturalActive: isNaturalActive(naturalState),
    naturalStatus,
    naturalTranscript: naturalState.transcript,
    transcriptFinal: naturalState.transcriptFinal,
    naturalMode: naturalState.inputMode,
    micCapabilities,
    naturalSttAvailable,
    recommendedMode,
    micDenied,
    micDeniedReason,
    naturalSentence,
    enableNatural: async (mode) => {
      const engine = engineRef.current;
      if (!engine) {
        return;
      }
      // text_only is a plain-text (composer) mode: it must not open the mic or
      // pretend to "listen". Just record the mode and stay idle.
      if (mode === "text_only") {
        setMicDenied(false);
        setMicDeniedReason(null);
        engine.setMode("text_only");
        return;
      }
      setMicDenied(false);
      setMicDeniedReason(null);
      try {
        await engine.enable(mode);
      } catch (caught) {
        if (caught instanceof VadStartError) {
          if (caught.reason === "permission-denied") {
            setMicDenied(true);
            setMicDeniedReason(caught.message);
          }
          // Reset the machine to idle so the UI never sits in "listening"
          // without an actually-open microphone.
          await engine.disable();
        }
        // Other VAD start errors degrade silently (the caller falls back to
        // push-to-talk / text), matching the pre-existing behavior.
      }
    },
    disableNatural: () => engineRef.current?.disable() ?? Promise.resolve(),
    setNaturalMode: (mode) => engineRef.current?.setMode(mode),
    retryNatural: () => engineRef.current?.retry() ?? Promise.resolve(),
    onTranscriptEdit: (text) => engineRef.current?.onTranscriptEdit(text),
    onTranscriptConfirm: () => {
      const text = naturalState.transcript;
      engineRef.current?.onTranscriptConfirm(text);
    },
    interruptNatural: () => engineRef.current?.interrupt(),
    onAssistantAudioEnded: () => engineRef.current?.onAssistantAudioEnded(),
  };
}

// Minimal local id counter for natural-mode message insertion.
let naturalMessageId = 10_000;
function nextIdLocal(): number {
  naturalMessageId += 1;
  return naturalMessageId;
}

/** Builds the default reply streamer over the existing SSE pipeline. */
function buildStreamReply(): NaturalReplyStreamer {
  return async ({
    query,
    conversationId,
    signal,
    onGenerationId,
    onFirstToken,
    onText,
    onAudio,
  }) => {
    let errorMessage = "";
    let retryable = false;
    let finalText = "";
    let audioReceived = false;
    await streamConversationReply({
      query,
      conversationId,
      signal,
      events: {
        onGenerationStarted: (id) => onGenerationId(id),
        onToken: (text) => {
          // Real incremental text tokens feed the reply chunker so complete
          // sentences flush to the strict-order TTS queue in sequence.
          onFirstToken();
          onText?.(text);
        },
        onAudio: (base64) => {
          audioReceived = true;
          onAudio(base64);
        },
        onDone: (text) => {
          finalText = text;
        },
        onError: (message, r) => {
          errorMessage = message;
          retryable = r;
        },
      },
    });
    return {
      ok: errorMessage.length === 0,
      retryable,
      message: errorMessage,
      audioReceived,
      text: errorMessage.length === 0 ? finalText : undefined,
    };
  };
}