/**
 * Event-driven engine for the natural (hands-free) conversation mode.
 *
 * This class is deliberately React-free so the interrupt / race / reconnect
 * logic can be unit-tested deterministically. It composes the real sub-systems
 * through injected adapters:
 *
 *   - a VAD adapter (real mic or mock) that emits `onSpeechStart` / `onSpeechEnd`;
 *   - an STT factory that yields interim + final transcripts;
 *   - a reply streamer (the existing SSE pipeline) that reports generation id,
 *     first token, audio chunk and completion;
 *   - audio/avatar sink callbacks to actually play / stop the assistant voice.
 *
 * EVERY state change is delivered by a real event: a VAD speech event, an STT
 * interim/final event, a stream token/audio/error event, or a network event.
 * No natural phase is ever faked with a fixed timer.
 *
 * Race safety: a monotonically increasing `epoch` is bumped on every new
 * exchange, interrupt and stop. All async continuation callbacks re-check
 * `epoch` before acting, so a cancelled task can never (a) write a message,
 * (b) auto-play audio, (c) advance the machine, or (d) clobber a newer turn.
 */

import type { ConversationMetrics } from "../conversationMetrics";
import {
  naturalConversationReducer,
  initialNaturalConversationState,
  type NaturalConversationAction,
  type NaturalConversationState,
  type NaturalInputMode,
} from "./naturalConversationStateMachine";
import type { SttSessionFactory } from "./stt";
import type { VadAdapter } from "./vadAdapter";
import { createReplyChunker } from "./replyChunker";
import { createEchoGate } from "./echoGate";

export interface NaturalReplyOutcome {
  readonly ok: boolean;
  readonly retryable: boolean;
  readonly message: string;
  /** True when the reply delivered TTS audio (so the engine awaits playback). */
  readonly audioReceived: boolean;
  readonly text?: string;
}

export interface NaturalReplyStreamerInput {
  readonly query: string;
  readonly conversationId: string | null;
  readonly signal: AbortSignal;
  onGenerationId: (id: string) => void;
  onFirstToken: () => void;
  /** Streaming text tokens; complete sentences are flushed to the TTS. */
  onText?: (text: string) => void;
  onAudio: (audioBase64: string) => void;
}

/** Wraps the existing SSE reply pipeline, returning a normalized outcome. */
export type NaturalReplyStreamer = (
  input: NaturalReplyStreamerInput,
) => Promise<NaturalReplyOutcome>;

export interface NaturalConversationDeps {
  readonly vad: VadAdapter;
  readonly sttFactory: SttSessionFactory;
  readonly streamReply: NaturalReplyStreamer;
  /** Asks the sidecar to cancel a real generation_id. */
  readonly cancelGeneration: (generationId: string) => Promise<boolean>;
  /** Starts audible playback of a TTS chunk. */
  readonly playAudio: (audioBase64: string) => void;
  /** Stops any audible playback (and the avatar's speech action). */
  readonly stopAudio: () => void;
  /** Stops the avatar's subsequent actions (video/lipsync). */
  readonly stopAvatar: () => void;
  readonly getConversationId: () => string | null;
  /** Writes the assistant's FINAL text into the timeline (never on cancel). */
  readonly onReplyDelivered: (query: string, text: string) => void;
  /** Receives each flushed sentence to be sent to the TTS engine in order. */
  readonly onTtsSentence?: (sentence: string) => void;
  /** Whether the platform provides echo cancellation (from probeMicCapabilities). */
  readonly echoCancellation?: boolean;
  readonly onMetrics: (metrics: Partial<ConversationMetrics>) => void;
  readonly onStateChange: (state: NaturalConversationState) => void;
  readonly maxReconnectAttempts?: number;
  /** Reconnect backoff (real network retry timing, not a fake state). */
  readonly reconnectDelayMs?: (attempt: number) => number;
}

export interface NaturalConversationHandle {
  readonly getState: () => NaturalConversationState;
  enable(mode: NaturalInputMode): Promise<void>;
  disable(): Promise<void>;
  setMode(mode: NaturalInputMode): void;
  retry(): Promise<void>;
  /** VAD / push-to-talk speech start. */
  handleSpeechStart(): void;
  handleSpeechEnd(): Promise<void>;
  /** Called when the assistant's TTS audio element reports `ended`. */
  onAssistantAudioEnded(): void;
  /** User edits the live transcript. */
  onTranscriptEdit(text: string): void;
  /** User confirms the editable transcript to send it. */
  onTranscriptConfirm(text: string): void;
  /** Force a barge-in interrupt (e.g. safety button). */
  interrupt(): void;
  /** Stop everything without writing anything (unmount / switch human). */
  dispose(): Promise<void>;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createNaturalConversationEngine(
  deps: NaturalConversationDeps,
): NaturalConversationHandle {
  let state: NaturalConversationState = initialNaturalConversationState;
  let epoch = 0;
  let generationId: string | null = null;
  let abortController: AbortController | null = null;
  let sttSession: ReturnType<SttSessionFactory> | null = null;
  let speechStartMs = 0;
  let speechEndMs = 0;
  let speechToFirstTranscriptMs: number | null = null;

  const maxReconnect = deps.maxReconnectAttempts ?? 2;
  const reconnectDelay = deps.reconnectDelayMs ?? ((attempt: number) => attempt * 500);
  // Playback-aware echo gate: suppresses suspected echo bursts right after the
  // assistant starts speaking, while still letting a real user utterance barge in.
  const echoGate = createEchoGate({ echoCancellation: deps.echoCancellation ?? false });

  function dispatch(action: NaturalConversationAction): void {
    state = naturalConversationReducer(state, action);
    deps.onStateChange(state);
  }

  function openSttSession(): void {
    if (sttSession) {
      return;
    }
    const session = deps.sttFactory({
      onInterim: (text) => {
        if (speechToFirstTranscriptMs === null && text.length > 0) {
          speechToFirstTranscriptMs = performance.now() - speechStartMs;
          deps.onMetrics({ speechToFirstTranscriptMs });
        }
        dispatch({ type: "INTERIM", text });
      },
      onError: () => {
        // Recognition errors degrade to the fallback path (empty final);
        // the phase is driven by real events, not by this callback alone.
      },
    });
    sttSession = session;
    session.start();
  }

  function handleSpeechStart(): void {
    // Suppress a VAD speech-start that is likely the assistant's own voice
    // echoing off the mic right after playback began. A real user utterance is
    // always passed through so barge-in stays armed.
    if (echoGate.classifySpeechStart(performance.now()) === "suppress") {
      return;
    }
    const phase = state.phase;
    // Barge-in: the user starts speaking while the assistant is audible or
    // still thinking -> cancel the current turn immediately.
    if (phase === "speaking" || phase === "thinking") {
      interrupt();
      return;
    }
    dispatch({ type: "SPEECH_START" });
    speechStartMs = performance.now();
    speechToFirstTranscriptMs = null;
    openSttSession();
  }

  async function handleSpeechEnd(): Promise<void> {
    const currentEpoch = epoch;
    dispatch({ type: "SPEECH_END" });
    speechEndMs = performance.now();
    const session = sttSession;
    sttSession = null;
    let final = "";
    if (session) {
      final = await session.stop();
    }
    if (currentEpoch !== epoch) {
      return; // cancelled / interrupted while transcribing
    }
    const trimmed = final.trim();
    if (!trimmed) {
      dispatch({ type: "TRANSCRIPT_CLEARED" });
      return;
    }
    deps.onMetrics({
      speechEndToTranscriptMs: performance.now() - speechEndMs,
    });
    void beginReply(trimmed);
  }

  async function beginReply(query: string): Promise<void> {
    const currentEpoch = ++epoch;
    dispatch({ type: "TRANSCRIPT_CONFIRMED", text: query });
    const submitAt = performance.now();
    let attempts = 0;

    while (true) {
      const controller = new AbortController();
      abortController = controller;
      generationId = null;
      let firstTokenAt: number | null = null;
      let audioReceived = false;
      // Buffers streaming text and flushes complete sentences to the TTS in
      // order, so speech can start before the full reply is generated.
      const chunker = createReplyChunker((sentence) => {
        if (currentEpoch === epoch) {
          deps.onTtsSentence?.(sentence);
        }
      });

      dispatch({ type: "REPLY_START" });

      const outcome = await deps.streamReply({
        query,
        conversationId: deps.getConversationId(),
        signal: controller.signal,
        onGenerationId: (id) => {
          if (currentEpoch === epoch) {
            generationId = id;
          }
        },
        onFirstToken: () => {
          if (currentEpoch !== epoch) {
            return;
          }
          if (firstTokenAt === null) {
            firstTokenAt = performance.now();
            deps.onMetrics({
              submitToFirstTokenMs: firstTokenAt - submitAt,
            });
          }
        },
        onText: (text) => {
          if (currentEpoch === epoch) {
            chunker.push(text);
          }
        },
        onAudio: (audioBase64) => {
          if (currentEpoch !== epoch) {
            return;
          }
          audioReceived = true;
          if (firstTokenAt !== null) {
            deps.onMetrics({
              firstTokenToFirstAudioMs: performance.now() - firstTokenAt,
            });
          }
          echoGate.onAssistantStarted(performance.now());
          dispatch({ type: "ASSISTANT_STARTED" });
          deps.playAudio(audioBase64);
        },
      });

      if (currentEpoch !== epoch) {
        return; // interrupted / stopped while streaming
      }
      if (outcome.ok) {
        // Flush any leftover trailing text fragment at end of stream.
        chunker.finish();
        if (outcome.text) {
          deps.onReplyDelivered(query, outcome.text);
        }
        if (outcome.audioReceived) {
          // TTS audio was delivered; ensure the machine is in `speaking`
          // (idempotent with the onAudio callback that already dispatched
          // ASSISTANT_STARTED). ASSISTANT_ENDED arrives via the audio element.
          echoGate.onAssistantStarted(performance.now());
          dispatch({ type: "ASSISTANT_STARTED" });
        } else {
          // Text fallback: no TTS audio, the turn is complete. ASSISTANT_ENDED
          // is only legal from `speaking`, so briefly enter `speaking` to
          // return to `listening` (no audio is played in this path).
          dispatch({ type: "ASSISTANT_STARTED" });
          dispatch({ type: "ASSISTANT_ENDED" });
        }
        return;
      }

      if (outcome.retryable && attempts < maxReconnect) {
        attempts += 1;
        dispatch({ type: "NETWORK_RECONNECTING" });
        await delay(reconnectDelay(attempts));
        if (currentEpoch !== epoch) {
          return;
        }
        continue; // retry with a fresh controller; REPLY_START re-enters thinking
      }
      dispatch({ type: "ERROR", message: outcome.message });
      return;
    }
  }

  function interrupt(): void {
    epoch += 1;
    const interruptAt = performance.now();
    const genId = generationId;
    abortController?.abort();
    abortController = null;
    sttSession?.abort();
    sttSession = null;
    if (genId) {
      deps.cancelGeneration(genId).catch(() => {
        // Cancel is best-effort; the client abort already closed the stream.
      });
    }
    deps.stopAudio();
    deps.stopAvatar();
    echoGate.onAssistantEnded();
    deps.onMetrics({ interruptToSilenceMs: performance.now() - interruptAt });
    dispatch({ type: "INTERRUPT" });
    dispatch({ type: "INTERRUPT_RESOLVED" });
  }

  async function enable(mode: NaturalInputMode): Promise<void> {
    dispatch({ type: "START" });
    dispatch({ type: "MODE_SET", mode });
    if (mode === "natural") {
      await deps.vad.start({
        onSpeechStart: () => handleSpeechStart(),
        onSpeechEnd: () => {
          void handleSpeechEnd();
        },
      });
    }
  }

  async function disable(): Promise<void> {
    epoch += 1;
    abortController?.abort();
    abortController = null;
    sttSession?.abort();
    sttSession = null;
    deps.stopAudio();
    deps.stopAvatar();
    echoGate.onAssistantEnded();
    await deps.vad.stop();
    dispatch({ type: "STOP" });
  }

  return {
    getState: () => state,
    enable,
    disable,
    setMode: (mode) => dispatch({ type: "MODE_SET", mode }),
    retry: async () => {
      dispatch({ type: "RETRY" });
      if (state.inputMode === "natural") {
        await deps.vad.start({
          onSpeechStart: () => handleSpeechStart(),
          onSpeechEnd: () => {
            void handleSpeechEnd();
          },
        });
      }
    },
    handleSpeechStart,
    handleSpeechEnd,
    onAssistantAudioEnded: () => {
      echoGate.onAssistantEnded();
      dispatch({ type: "ASSISTANT_ENDED" });
    },
    onTranscriptEdit: (text) => dispatch({ type: "INTERIM", text }),
    onTranscriptConfirm: (text) => {
      const trimmed = text.trim();
      if (!trimmed) {
        dispatch({ type: "TRANSCRIPT_CLEARED" });
        return;
      }
      void beginReply(trimmed);
    },
    interrupt,
    dispose: disable,
  };
}