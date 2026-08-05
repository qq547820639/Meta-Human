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
  createMockSttSession,
  hasBrowserStt,
  type SttSessionFactory,
} from "./natural/stt";
import {
  createBrowserVadAdapter,
  noMicCapabilities,
  probeMicCapabilities,
  type MicCapabilities,
  type VadAdapter,
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

  const engineRef = useRef<NaturalConversationHandle | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const humanIdRef = useRef<string | null | undefined>(humanId);

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

  // Build the engine lazily (once per mount).
  if (engineRef.current === null) {
    const engine = createNaturalConversationEngine({
      vad: vadFactory ? vadFactory() : createBrowserVadAdapter(),
      sttFactory:
        sttFactory ??
        ((callbacks) =>
          createBrowserSttSession(callbacks) ?? createMockSttSession(callbacks)),
      streamReply: streamReplyOverride ?? buildStreamReply(),
      cancelGeneration: (generationId) => stopGenerating(generationId),
      playAudio: (audioBase64) => {
        const node = new Audio(
          `data:audio/wav;base64,${audioBase64}`,
        );
        audioRef.current = node;
        node.onended = () => engine.onAssistantAudioEnded();
        node.onerror = () => engine.onAssistantAudioEnded();
        void node.play().catch(() => {
          // Autoplay may be blocked; fall back to silent text turn.
          engine.onAssistantAudioEnded();
        });
      },
      stopAudio: () => {
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
      onMetrics: (m) => onMetricsRef.current(m),
      onStateChange: setNaturalState,
    });
    engineRef.current = engine;
  }

  return {
    naturalState,
    naturalActive: isNaturalActive(naturalState),
    naturalStatus: naturalStatusLabel(naturalState),
    naturalTranscript: naturalState.transcript,
    transcriptFinal: naturalState.transcriptFinal,
    naturalMode: naturalState.inputMode,
    micCapabilities,
    naturalSttAvailable: hasBrowserStt() || !!sttFactory,
    enableNatural: (mode) => engineRef.current?.enable(mode) ?? Promise.resolve(),
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
        onToken: () => onFirstToken(),
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