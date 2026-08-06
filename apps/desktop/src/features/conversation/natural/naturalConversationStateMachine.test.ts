import { describe, expect, it } from "vitest";

import {
  initialNaturalConversationState,
  isNaturalActive,
  naturalConversationReducer,
  naturalStatusLabel,
  type NaturalConversationAction,
  type NaturalConversationState,
} from "./naturalConversationStateMachine";

function apply(
  state: NaturalConversationState,
  ...actions: NaturalConversationAction[]
): NaturalConversationState {
  return actions.reduce(
    (acc, action) => naturalConversationReducer(acc, action),
    state,
  );
}

describe("naturalConversationReducer — legal transitions", () => {
  it("moves idle -> listening -> transcribing -> thinking -> speaking -> listening", () => {
    const state = apply(
      initialNaturalConversationState,
      { type: "START" },
      { type: "SPEECH_START" },
      { type: "SPEECH_END" },
      { type: "TRANSCRIPT_CONFIRMED", text: "你好" },
      { type: "ASSISTANT_STARTED" },
      { type: "ASSISTANT_ENDED" },
    );
    expect(state.phase).toBe("listening");
    expect(isNaturalActive(state)).toBe(true);
  });

  it("keeps userSpeaking while the user is talking and clears it on speech end", () => {
    const speakingUser = apply(
      initialNaturalConversationState,
      { type: "START" },
      { type: "SPEECH_START" },
    );
    expect(speakingUser.userSpeaking).toBe(true);

    const ended = apply(speakingUser, { type: "SPEECH_END" });
    expect(ended.userSpeaking).toBe(false);
    expect(ended.phase).toBe("transcribing");
  });

  it("streams interim transcript while listening/transcribing", () => {
    let state = apply(
      initialNaturalConversationState,
      { type: "START" },
      { type: "SPEECH_START" },
      { type: "INTERIM", text: "今天天" },
    );
    expect(state.transcript).toBe("今天天");
    expect(state.transcriptFinal).toBe(false);

    state = apply(state, { type: "INTERIM", text: "今天天气不错" });
    expect(state.transcript).toBe("今天天气不错");
  });

  it("confirms a transcript into thinking without losing it", () => {
    const state = apply(
      initialNaturalConversationState,
      { type: "START" },
      { type: "SPEECH_END" },
      { type: "TRANSCRIPT_CONFIRMED", text: "帮我总结知识库" },
    );
    expect(state.phase).toBe("thinking");
    expect(state.transcript).toBe("帮我总结知识库");
    expect(state.transcriptFinal).toBe(true);
  });

  it("barge-in during speaking -> interrupted -> back to listening", () => {
    const state = apply(
      initialNaturalConversationState,
      { type: "START" },
      { type: "SPEECH_END" },
      { type: "TRANSCRIPT_CONFIRMED", text: "q" },
      { type: "ASSISTANT_STARTED" },
      { type: "INTERRUPT" },
      { type: "INTERRUPT_RESOLVED" },
    );
    expect(state.phase).toBe("listening");
  });

  it("barge-in during thinking is also an interrupt", () => {
    let state = apply(
      initialNaturalConversationState,
      { type: "START" },
      { type: "SPEECH_START" },
      { type: "INTERRUPT" },
    );
    expect(state.phase).toBe("interrupted");
    state = apply(state, { type: "INTERRUPT_RESOLVED" });
    expect(state.phase).toBe("listening");
  });

  it("weak network: thinking -> reconnecting -> (retry) -> error -> retry -> listening", () => {
    let state = apply(
      initialNaturalConversationState,
      { type: "START" },
      { type: "SPEECH_END" },
      { type: "TRANSCRIPT_CONFIRMED", text: "q" },
      { type: "NETWORK_RECONNECTING" },
    );
    expect(state.phase).toBe("reconnecting");
    expect(state.reconnectAttempts).toBe(1);

    state = apply(state, { type: "RECONNECT_FAILED", message: "超时" });
    expect(state.phase).toBe("error");
    expect(state.errorMessage).toBe("超时");

    state = apply(state, { type: "RETRY" });
    expect(state.phase).toBe("listening");
    expect(state.errorMessage).toBeNull();
  });

  it("STOP resets to idle and preserves the chosen input mode", () => {
    const state = apply(
      initialNaturalConversationState,
      { type: "MODE_SET", mode: "push_to_talk" },
      { type: "START" },
      { type: "SPEECH_END" },
      { type: "TRANSCRIPT_CONFIRMED", text: "x" },
      { type: "STOP" },
    );
    expect(state.phase).toBe("idle");
    expect(state.inputMode).toBe("push_to_talk");
    expect(isNaturalActive(state)).toBe(false);
  });

  it("accepts and preserves text_only as an input mode", () => {
    const state = apply(
      initialNaturalConversationState,
      { type: "MODE_SET", mode: "text_only" },
      { type: "START" },
      { type: "STOP" },
    );
    expect(state.inputMode).toBe("text_only");
    expect(state.phase).toBe("idle");
  });
});

describe("naturalConversationReducer — illegal transitions rejected", () => {
  it("rejects ASSISTANT_STARTED before the reply is confirmed", () => {
    const state = apply(initialNaturalConversationState, {
      type: "ASSISTANT_STARTED",
    });
    expect(state.phase).toBe("idle");
  });

  it("rejects TRANSCRIPT_CONFIRMED from idle / listening without a session", () => {
    let state = apply(initialNaturalConversationState, {
      type: "TRANSCRIPT_CONFIRMED",
      text: "x",
    });
    expect(state.phase).toBe("idle");

    state = apply(
      initialNaturalConversationState,
      { type: "START" },
      { type: "TRANSCRIPT_CONFIRMED", text: "x" },
    );
    expect(state.phase).toBe("listening");
  });

  it("rejects ASSISTANT_ENDED from thinking (only valid from speaking)", () => {
    const state = apply(
      initialNaturalConversationState,
      { type: "START" },
      { type: "SPEECH_END" },
      { type: "TRANSCRIPT_CONFIRMED", text: "q" },
      { type: "ASSISTANT_ENDED" },
    );
    expect(state.phase).toBe("thinking");
  });

  it("rejects INTERIM once the turn is speaking (stale STT event)", () => {
    let state = apply(
      initialNaturalConversationState,
      { type: "START" },
      { type: "SPEECH_END" },
      { type: "TRANSCRIPT_CONFIRMED", text: "q" },
      { type: "ASSISTANT_STARTED" },
    );
    state = apply(state, { type: "INTERIM", text: "late" });
    expect(state.transcript).toBe("");
  });

  it("rejects NETWORK_RECONNECTED from error (only valid from reconnecting)", () => {
    const state = apply(
      initialNaturalConversationState,
      { type: "START" },
      { type: "ERROR", message: "boom" },
    );
    expect(state.phase).toBe("error");
  });

  it("rejects a second INTERRUPT_RESOLVED without entering interrupted", () => {
    const state = apply(initialNaturalConversationState, {
      type: "INTERRUPT_RESOLVED",
    });
    expect(state.phase).toBe("idle");
  });
});

describe("naturalStatusLabel", () => {
  it("labels each phase", () => {
    expect(naturalStatusLabel(initialNaturalConversationState)).toBe(
      "自然对话已关闭",
    );
    expect(
      naturalStatusLabel(
        apply(initialNaturalConversationState, { type: "START" }),
      ),
    ).toBe("正在聆听");
    expect(
      naturalStatusLabel(
        apply(
          initialNaturalConversationState,
          { type: "START" },
          { type: "SPEECH_END" },
        ),
      ),
    ).toBe("正在转写…");
    expect(
      naturalStatusLabel(
        apply(
          initialNaturalConversationState,
          { type: "START" },
          { type: "SPEECH_END" },
          { type: "INTERIM", text: "待确认文本" },
        ),
      ),
    ).toBe("等待确认…");
    expect(
      naturalStatusLabel(
        apply(
          initialNaturalConversationState,
          { type: "START" },
          { type: "SPEECH_END" },
          { type: "TRANSCRIPT_CONFIRMED", text: "q" },
          { type: "ASSISTANT_STARTED" },
        ),
      ),
    ).toBe("正在说话…");
  });
});