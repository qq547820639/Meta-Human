/**
 * Deterministic reducer state machine for a NATURAL (hands-free, VAD-driven)
 * conversation mode, layered on top of the existing turn-based parallel
 * machine (`conversationStateMachine.ts`).
 *
 * The existing machine models SIX independent sub-state dimensions that can
 * advance in parallel (generation / tts / avatar / recording / network /
 * restore). It is driven by discrete events (click-to-send, stream events,
 * DOM events) and each event targets exactly one dimension.
 *
 * Natural mode is different: it is a single linear turn contract driven by a
 * *continuous* input medium (an open microphone + voice-activity detection),
 * so the user sees ONE phase at a time:
 *
 *   idle -> listening -> transcribing -> thinking -> speaking
 *                          ^              |            |
 *                          |              v            v
 *                          +-- trial loop        interrupted -> listening
 *
 * Because the mic is always open, the user can "barge in" at any time. That
 * interrupt is a real event (VAD speech start) and is the ONLY thing that can
 * take the machine out of `speaking` / `thinking` back to `listening`.
 *
 * Every transition is validated: an action that is not legal in the current
 * phase is REJECTED (the reducer returns the previous phase unchanged), so
 * stale / out-of-order stream events, a fast sequence of interrupts, or a
 * late "assistant ended" event after a stop can never corrupt the model.
 *
 * No phase is ever faked with a timer: `listening` is entered only when the
 * VAD / mic is actually open, `transcribing` only when a transcription
 * session is running, `thinking` only when an LLM reply stream is in flight,
 * `speaking` only when TTS audio is actually playing, and `reconnecting` /
 * `error` only when a real network event fires.
 */

export type NaturalConversationPhase =
  | "idle"
  | "listening"
  | "transcribing"
  | "thinking"
  | "speaking"
  | "interrupted"
  | "reconnecting"
  | "error";

/** How the user drives the mic. `natural` = VAD auto; `push_to_talk` = hold. */
export type NaturalInputMode = "natural" | "push_to_talk";

export interface NaturalConversationState {
  readonly phase: NaturalConversationPhase;
  readonly inputMode: NaturalInputMode;
  /** True while the user is actually producing speech (VAD active). */
  readonly userSpeaking: boolean;
  /** The editable interim / confirmed transcript currently on screen. */
  readonly transcript: string;
  /** True once the transcript has been confirmed and sent. */
  readonly transcriptFinal: boolean;
  /** How many reconnect attempts have been made for the current exchange. */
  readonly reconnectAttempts: number;
  readonly errorMessage: string | null;
}

export const initialNaturalConversationState: NaturalConversationState = {
  phase: "idle",
  inputMode: "natural",
  userSpeaking: false,
  transcript: "",
  transcriptFinal: false,
  reconnectAttempts: 0,
  errorMessage: null,
};

export type NaturalConversationAction =
  | { readonly type: "MODE_SET"; readonly mode: NaturalInputMode }
  | { readonly type: "START" }
  | { readonly type: "STOP" }
  // VAD / mic events (real)
  | { readonly type: "SPEECH_START" }
  | { readonly type: "SPEECH_END" }
  // STT events (real)
  | { readonly type: "INTERIM"; readonly text: string }
  | { readonly type: "TRANSCRIPT_CLEARED" }
  | { readonly type: "TRANSCRIPT_CONFIRMED"; readonly text: string }
  // reply stream events (real)
  | { readonly type: "REPLY_START" }
  | { readonly type: "ASSISTANT_STARTED" }
  | { readonly type: "ASSISTANT_ENDED" }
  | { readonly type: "INTERRUPT" }
  | { readonly type: "INTERRUPT_RESOLVED" }
  // network events (real)
  | { readonly type: "NETWORK_RECONNECTING" }
  | { readonly type: "NETWORK_RECONNECTED" }
  | { readonly type: "RECONNECT_FAILED"; readonly message: string }
  | { readonly type: "ERROR"; readonly message: string }
  | { readonly type: "RETRY" };

function base(state: NaturalConversationState): NaturalConversationState {
  return state;
}

function next(
  state: NaturalConversationState,
  patch: Partial<NaturalConversationState>,
): NaturalConversationState {
  return { ...state, ...patch };
}

/**
 * Phase transition table. Returns the phase to move to, or `null` to REJECT
 * the transition (the reducer keeps the current phase).
 */
function phaseTarget(
  phase: NaturalConversationPhase,
  action: NaturalConversationAction,
): NaturalConversationPhase | null {
  switch (phase) {
    case "idle":
      switch (action.type) {
        case "START":
          return "listening";
        case "RETRY":
          return "listening";
        default:
          return null;
      }
    case "listening":
      switch (action.type) {
        case "SPEECH_END":
          return "transcribing";
        case "REPLY_START":
          return "thinking";
        case "INTERRUPT":
          return "interrupted";
        case "NETWORK_RECONNECTING":
          return "reconnecting";
        case "ERROR":
          return "error";
        default:
          return null;
      }
    case "transcribing":
      switch (action.type) {
        case "TRANSCRIPT_CONFIRMED":
          return "thinking";
        case "TRANSCRIPT_CLEARED":
          return "listening";
        case "REPLY_START":
          return "thinking";
        case "INTERRUPT":
          return "interrupted";
        case "NETWORK_RECONNECTING":
          return "reconnecting";
        case "ERROR":
          return "error";
        default:
          return null;
      }
    case "thinking":
      switch (action.type) {
        case "ASSISTANT_STARTED":
          return "speaking";
        case "SPEECH_START":
          return "interrupted";
        case "INTERRUPT":
          return "interrupted";
        case "NETWORK_RECONNECTING":
          return "reconnecting";
        case "ERROR":
          return "error";
        default:
          return null;
      }
    case "speaking":
      switch (action.type) {
        case "ASSISTANT_ENDED":
          return "listening";
        case "SPEECH_START":
          return "interrupted";
        case "INTERRUPT":
          return "interrupted";
        case "NETWORK_RECONNECTING":
          return "reconnecting";
        case "ERROR":
          return "error";
        default:
          return null;
      }
    case "interrupted":
      switch (action.type) {
        case "INTERRUPT_RESOLVED":
          return "listening";
        case "NETWORK_RECONNECTING":
          return "reconnecting";
        case "ERROR":
          return "error";
        default:
          return null;
      }
    case "reconnecting":
      switch (action.type) {
        case "NETWORK_RECONNECTED":
          return "listening";
        case "REPLY_START":
          return "thinking";
        case "RECONNECT_FAILED":
          return "error";
        case "ERROR":
          return "error";
        default:
          return null;
      }
    case "error":
      switch (action.type) {
        case "RETRY":
          return "listening";
        case "START":
          return "listening";
        default:
          return null;
      }
  }
}

export function naturalConversationReducer(
  state: NaturalConversationState,
  action: NaturalConversationAction,
): NaturalConversationState {
  // Global actions that always apply regardless of phase.
  switch (action.type) {
    case "MODE_SET":
      return next(base(state), { inputMode: action.mode });
    case "STOP":
      return {
        ...initialNaturalConversationState,
        inputMode: state.inputMode,
      };
    case "SPEECH_START":
      // userSpeaking is a sub-dimension; it flips on while the phase logic
      // (barge-in) is handled below / by the phase table.
      if (state.userSpeaking) {
        return state;
      }
      {
        const target = phaseTarget(state.phase, action);
        return next(base(state), {
          userSpeaking: true,
          phase: target === null ? state.phase : target,
        });
      }
    case "SPEECH_END":
      {
        const target = phaseTarget(state.phase, action);
        return next(base(state), {
          userSpeaking: false,
          phase: target === null ? state.phase : target,
        });
      }
    case "INTERIM":
      // Interim transcript streams live while the user is still speaking
      // (phase `listening` with `userSpeaking`) and while the finalization
      // STT session is winding down (phase `transcribing`). It is editable on
      // screen in both phases but never moves the phase by itself.
      return state.phase === "transcribing" || state.phase === "listening"
        ? next(base(state), { transcript: action.text, transcriptFinal: false })
        : state;
    case "TRANSCRIPT_CONFIRMED":
      return phaseTarget(state.phase, action) === "thinking"
        ? next(base(state), {
            phase: "thinking",
            transcript: action.text,
            transcriptFinal: true,
            reconnectAttempts: 0,
          })
        : state;
    case "TRANSCRIPT_CLEARED":
      return phaseTarget(state.phase, action) === "listening"
        ? next(base(state), {
            phase: "listening",
            transcript: "",
            transcriptFinal: false,
          })
        : state;
    case "REPLY_START":
      return phaseTarget(state.phase, action) === "thinking"
        ? next(base(state), { phase: "thinking", transcriptFinal: true })
        : state;
    case "ASSISTANT_STARTED":
      return phaseTarget(state.phase, action) === "speaking"
        ? next(base(state), {
            phase: "speaking",
            transcript: "",
            transcriptFinal: false,
          })
        : state;
    case "ASSISTANT_ENDED":
      return phaseTarget(state.phase, action) === "listening"
        ? next(base(state), {
            phase: "listening",
            transcript: "",
            transcriptFinal: false,
          })
        : state;
    case "INTERRUPT":
      return phaseTarget(state.phase, action) === "interrupted"
        ? next(base(state), {
            phase: "interrupted",
            transcript: "",
            transcriptFinal: false,
            userSpeaking: false,
          })
        : state;
    case "INTERRUPT_RESOLVED":
      return phaseTarget(state.phase, action) === "listening"
        ? next(base(state), { phase: "listening" })
        : state;
    case "NETWORK_RECONNECTING":
      return phaseTarget(state.phase, action) === "reconnecting"
        ? next(base(state), {
            phase: "reconnecting",
            reconnectAttempts: state.reconnectAttempts + 1,
          })
        : state;
    case "NETWORK_RECONNECTED":
      return phaseTarget(state.phase, action) === "listening"
        ? next(base(state), { phase: "listening" })
        : state;
    case "RECONNECT_FAILED":
      return phaseTarget(state.phase, action) === "error"
        ? next(base(state), { phase: "error", errorMessage: action.message })
        : state;
    case "ERROR":
      return phaseTarget(state.phase, action) === "error"
        ? next(base(state), { phase: "error", errorMessage: action.message })
        : state;
    case "RETRY":
      return phaseTarget(state.phase, action) === "listening"
        ? next(base(state), {
            phase: "listening",
            errorMessage: null,
            reconnectAttempts: 0,
            transcript: "",
            transcriptFinal: false,
          })
        : state;
    case "START":
      return phaseTarget(state.phase, action) === "listening"
        ? next(base(state), {
            phase: "listening",
            errorMessage: null,
            reconnectAttempts: 0,
          })
        : state;
  }
}

/** True while natural mode is engaged (any phase other than idle). */
export function isNaturalActive(state: NaturalConversationState): boolean {
  return state.phase !== "idle";
}

/** True while the assistant is audibly speaking. */
export function isNaturalSpeaking(state: NaturalConversationState): boolean {
  return state.phase === "speaking";
}

/** True while the user is actively producing speech. */
export function isUserSpeaking(state: NaturalConversationState): boolean {
  return state.userSpeaking;
}

/** Compact human-readable label for the current natural phase. */
export function naturalStatusLabel(state: NaturalConversationState): string {
  switch (state.phase) {
    case "listening":
      return state.userSpeaking ? "聆听中…" : "正在聆听";
    case "transcribing":
      return "正在转写…";
    case "thinking":
      return "正在思考…";
    case "speaking":
      return "正在说话…";
    case "interrupted":
      return "已打断";
    case "reconnecting":
      return `网络不稳定，正在重连（${state.reconnectAttempts}）…`;
    case "error":
      return `出错了${state.errorMessage ? `：${state.errorMessage}` : ""}`;
    case "idle":
      return "自然对话已关闭";
  }
}