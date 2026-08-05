import { describe, expect, it, vi } from "vitest";

import type { ConversationMetrics } from "../conversationMetrics";
import {
  createNaturalConversationEngine,
  type NaturalReplyStreamer,
  type NaturalReplyOutcome,
} from "./naturalConversationCore";
import type { NaturalConversationState } from "./naturalConversationStateMachine";
import { createMockSttSession, type SttSession } from "./stt";
import { createMockVadAdapter } from "./vadAdapter";

interface Harness {
  engine: ReturnType<typeof createNaturalConversationEngine>;
  states: NaturalConversationState[];
  playAudio: ReturnType<typeof vi.fn>;
  stopAudio: ReturnType<typeof vi.fn>;
  stopAvatar: ReturnType<typeof vi.fn>;
  cancelGeneration: ReturnType<typeof vi.fn>;
  delivered: ReturnType<typeof vi.fn>;
  metrics: Partial<ConversationMetrics>[];
  sttSession: SttSession & {
    emitInterim: (t: string) => void;
    emitFinal: (t: string) => void;
  };
  resolveReply: (outcome: NaturalReplyOutcome) => void;
  replyCbs: {
    onGenerationId: (id: string) => void;
    onFirstToken: () => void;
    onAudio: (audioBase64: string) => void;
  } | null;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createHarness(opts?: {
  stream?: (getH: () => Harness) => NaturalReplyStreamer;
  maxReconnectAttempts?: number;
}): Harness {
  const states: NaturalConversationState[] = [];
  const playAudio = vi.fn();
  const stopAudio = vi.fn();
  const stopAvatar = vi.fn();
  const cancelGeneration = vi.fn().mockResolvedValue(true);
  const delivered = vi.fn();
  const metrics: Partial<ConversationMetrics>[] = [];

  const sttSessionRef: {
    current: Harness["sttSession"] | null;
  } = { current: null };
  const sttFactory = (callbacks: Parameters<typeof createMockSttSession>[0]) => {
    const session = createMockSttSession(callbacks);
    sttSessionRef.current = session;
    return session;
  };

  const replyDef = deferred<NaturalReplyOutcome>();
  const replyCbsRef: { current: Harness["replyCbs"] } = { current: null };

  const mockHarness = {} as Harness;
  const defaultStream: NaturalReplyStreamer = (input) => {
    replyCbsRef.current = input;
    return replyDef.promise;
  };

  const engine = createNaturalConversationEngine({
    vad: createMockVadAdapter(),
    sttFactory,
    streamReply: opts?.stream ? opts.stream(() => mockHarness) : defaultStream,
    cancelGeneration,
    playAudio,
    stopAudio,
    stopAvatar,
    getConversationId: () => "conv-1",
    onReplyDelivered: delivered,
    onMetrics: (m) => metrics.push(m),
    onStateChange: (s) => states.push(s),
    maxReconnectAttempts: opts?.maxReconnectAttempts ?? 2,
    reconnectDelayMs: () => 0,
  });

  Object.defineProperty(mockHarness, "sttSession", {
    get: () => sttSessionRef.current,
    enumerable: true,
  });
  Object.defineProperty(mockHarness, "replyCbs", {
    get: () => replyCbsRef.current,
    enumerable: true,
  });
  mockHarness.engine = engine;
  mockHarness.states = states;
  mockHarness.playAudio = playAudio;
  mockHarness.stopAudio = stopAudio;
  mockHarness.stopAvatar = stopAvatar;
  mockHarness.cancelGeneration = cancelGeneration;
  mockHarness.delivered = delivered;
  mockHarness.metrics = metrics;
  mockHarness.resolveReply = replyDef.resolve;
  return mockHarness;
}

async function speakAndFinish(h: Harness, text: string) {
  h.engine.handleSpeechStart();
  h.sttSession.emitInterim(text.slice(0, 2));
  const endPromise = h.engine.handleSpeechEnd();
  h.sttSession.emitFinal(text);
  await endPromise;
}

describe("natural conversation engine", () => {
  it("drives idle -> listening -> transcribing -> thinking -> speaking and delivers the reply", async () => {
    const h = createHarness();
    await h.engine.enable("push_to_talk");
    expect(h.states[0].phase).toBe("listening");

    await speakAndFinish(h, "你好");
    // streamReply was invoked; phase is waiting on the pending stream.
    expect(h.states.at(-1)?.phase).toBe("thinking");

    h.replyCbs?.onGenerationId("gen-1");
    h.replyCbs?.onFirstToken();
    h.replyCbs?.onAudio("AQID");
    h.resolveReply({
      ok: true,
      retryable: false,
      message: "",
      audioReceived: true,
      text: "你好呀",
    });
    await Promise.resolve();

    expect(h.delivered).toHaveBeenCalledWith("你好", "你好呀");
    expect(h.playAudio).toHaveBeenCalledTimes(1);
    expect(h.states.at(-1)?.phase).toBe("speaking");
  });

  it("interim transcript is surfaced to the UI while the user speaks", async () => {
    const h = createHarness();
    await h.engine.enable("push_to_talk");
    h.engine.handleSpeechStart();
    h.sttSession.emitInterim("今天天");
    h.sttSession.emitInterim("今天天气不错");
    const last = h.states.at(-1);
    expect(last?.transcript).toBe("今天天气不错");
    expect(last?.transcriptFinal).toBe(false);
  });

  it("interrupt during reply cancels generation, stops audio/avatar, and writes NO message", async () => {
    const h = createHarness();
    await h.engine.enable("push_to_talk");
    await speakAndFinish(h, "q");
    // thinking, reply pending (no audio yet)
    expect(h.states.at(-1)?.phase).toBe("thinking");

    h.replyCbs?.onGenerationId("gen-1"); // the SSE stream reports its generation id
    h.engine.handleSpeechStart(); // barge-in while the assistant is replying
    expect(h.cancelGeneration).toHaveBeenCalledWith("gen-1");
    expect(h.stopAudio).toHaveBeenCalledTimes(1);
    expect(h.stopAvatar).toHaveBeenCalledTimes(1);
    expect(h.delivered).not.toHaveBeenCalled();
    expect(h.playAudio).not.toHaveBeenCalled();

    // A late token/audio + completion must NOT write a message or play audio.
    h.replyCbs?.onAudio("LATE");
    h.resolveReply({
      ok: true,
      retryable: false,
      message: "",
      audioReceived: true,
      text: "太晚了",
    });
    await Promise.resolve();
    expect(h.delivered).not.toHaveBeenCalled();
    expect(h.playAudio).not.toHaveBeenCalled();
    expect(h.states.at(-1)?.phase).toBe("listening");
  });

  it("reconnects on a retryable failure and then succeeds (weak network)", async () => {
    const h = createHarness({
      stream: (self) => {
        let calls = 0;
        return async ({ onGenerationId, onFirstToken, onAudio }) => {
          calls += 1;
          onGenerationId(`gen-${calls}`);
          onFirstToken();
          if (calls === 1) {
            return { ok: false, retryable: true, message: "网络中断", audioReceived: false };
          }
          return { ok: true, retryable: false, message: "", audioReceived: true, text: "重连成功" };
        };
      },
    });
    await h.engine.enable("push_to_talk");
    await speakAndFinish(h, "重试");
    await Promise.resolve();
    // The reconnect backoff uses a real timer; flush a macrotask to let the
    // retry complete before asserting the final state.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.states.some((s) => s.phase === "reconnecting")).toBe(true);
    expect(h.delivered).toHaveBeenCalledWith("重试", "重连成功");
    expect(h.states.at(-1)?.phase).toBe("speaking");
    expect(h.metrics.some((m) => m.submitToFirstTokenMs !== undefined)).toBe(true);
  });

  it("records budget metrics along the pipeline", async () => {
    const h = createHarness();
    await h.engine.enable("push_to_talk");
    await speakAndFinish(h, "指标");
    h.replyCbs?.onFirstToken();
    h.replyCbs?.onAudio("AQID");
    h.resolveReply({ ok: true, retryable: false, message: "", audioReceived: true, text: "ok" });
    await Promise.resolve();
    const names = h.metrics.map((m) => Object.keys(m)[0]);
    expect(names).toContain("speechToFirstTranscriptMs");
    expect(names).toContain("speechEndToTranscriptMs");
    expect(names).toContain("submitToFirstTokenMs");
    expect(names).toContain("firstTokenToFirstAudioMs");
  });

  it("exhausts reconnect attempts and falls into error, then retry recovers", async () => {
    const h = createHarness({
      maxReconnectAttempts: 1,
      stream: () => async () => {
        return { ok: false, retryable: true, message: "一直断", audioReceived: false };
      },
    });
    await h.engine.enable("push_to_talk");
    await speakAndFinish(h, "断网");
    await Promise.resolve();
    // Flush the reconnect backoff timer so the final retryable failure lands.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.states.at(-1)?.phase).toBe("error");
    expect(h.delivered).not.toHaveBeenCalled();

    await h.engine.retry();
    expect(h.states.at(-1)?.phase).toBe("listening");
  });

  it("text fallback: no audio -> turn completes back to listening without speaking", async () => {
    const h = createHarness({
      stream: () => async ({ onFirstToken }) => {
        onFirstToken();
        return { ok: true, retryable: false, message: "", audioReceived: false, text: "仅文字" };
      },
    });
    await h.engine.enable("push_to_talk");
    await speakAndFinish(h, "纯文本");
    await Promise.resolve();
    expect(h.delivered).toHaveBeenCalledWith("纯文本", "仅文字");
    expect(h.playAudio).not.toHaveBeenCalled();
    expect(h.states.at(-1)?.phase).toBe("listening");
  });

  it("disable stops VAD, audio, avatar and aborts in-flight reply", async () => {
    const h = createHarness();
    await h.engine.enable("natural");
    h.engine.interrupt(); // ensure something to stop
    await h.engine.disable();
    expect(h.stopAudio).toHaveBeenCalled();
    expect(h.stopAvatar).toHaveBeenCalled();
    expect(h.states.at(-1)?.phase).toBe("idle");
  });
});