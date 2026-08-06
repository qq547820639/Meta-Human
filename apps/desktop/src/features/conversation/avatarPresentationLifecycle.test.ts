import { describe, expect, it } from "vitest";

import {
  deriveStaticPose,
  initialPresentationState,
  noPresentationCapabilities,
  presentationLifecycleReducer,
  resolvePresentationParams,
  type PresentationAction,
  type PresentationState,
} from "./avatarPresentationLifecycle";
import type { ConversationUiState } from "./conversationStateMachine";

function apply(
  state: PresentationState,
  ...actions: PresentationAction[]
): PresentationState {
  return actions.reduce(
    (acc, action) => presentationLifecycleReducer(acc, action),
    state,
  );
}

const idleUi: ConversationUiState = {
  generation: "idle",
  tts: "idle",
  avatar: "idle",
  recording: "idle",
  network: "online",
  restore: "idle",
};

describe("presentationLifecycleReducer — unified digital-human lifecycle", () => {
  it("starts static and only goes live when a stream begins", () => {
    expect(initialPresentationState).toEqual({
      stage: "fallback",
      mode: "static",
      reconnectAttempts: 0,
    });
    const live = apply(initialPresentationState, { type: "PRESENT_START" });
    expect(live).toEqual({ stage: "loading", mode: "live", reconnectAttempts: 0 });
  });

  it("advances loading -> buffering -> playing for a healthy live stream", () => {
    const loaded = apply(initialPresentationState, {
      type: "PRESENT_START",
    });
    expect(loaded.stage).toBe("loading");
    const buffering = apply(loaded, { type: "PRESENT_LOADED" });
    expect(buffering.stage).toBe("buffering");
    const playing = apply(buffering, { type: "PRESENT_PLAYING" });
    expect(playing.stage).toBe("playing");
    expect(playing.mode).toBe("live");
  });

  it("rejects loading/playing emitted out of order (no silent corruption)", () => {
    // PLAYING from the static fallback (no stream) must be rejected.
    let state = apply(initialPresentationState, { type: "PRESENT_PLAYING" });
    expect(state.stage).toBe("fallback");
    state = apply(state, { type: "PRESENT_LOADED" });
    expect(state.stage).toBe("fallback");
  });

  it("reconnects a dropped stream and degrades to static fallback", () => {
    // playing -> drop -> reconnecting (attempt 1) -> rebuild -> playing again.
    let state = apply(
      initialPresentationState,
      { type: "PRESENT_START" },
      { type: "PRESENT_LOADED" },
      { type: "PRESENT_PLAYING" },
      { type: "PRESENT_RECONNECT" },
    );
    expect(state.stage).toBe("reconnecting");
    expect(state.reconnectAttempts).toBe(1);
    state = apply(
      state,
      { type: "PRESENT_RECONNECTED" },
      { type: "PRESENT_LOADED" },
      { type: "PRESENT_PLAYING" },
    );
    expect(state.stage).toBe("playing");

    // Second drop -> reconnecting (attempt 2) -> give up -> fallback (static).
    state = apply(state, { type: "PRESENT_RECONNECT" });
    expect(state.reconnectAttempts).toBe(2);
    state = apply(state, { type: "PRESENT_FALLBACK" });
    expect(state.stage).toBe("fallback");
    expect(state.mode).toBe("static");
  });

  it("rejects RECONNECT unless a live stream is actively presenting", () => {
    // From loading (no data yet) or static fallback, a drop must not advance.
    let loading = apply(initialPresentationState, { type: "PRESENT_START" });
    loading = apply(loading, { type: "PRESENT_RECONNECT" });
    expect(loading.stage).toBe("loading");

    const staticState = apply(initialPresentationState, {
      type: "PRESENT_FALLBACK",
    });
    expect(apply(staticState, { type: "PRESENT_RECONNECT" }).stage).toBe(
      "fallback",
    );
  });

  it("degrades to fallback (static) on stream end while keeping the answer", () => {
    const state = apply(
      initialPresentationState,
      { type: "PRESENT_START" },
      { type: "PRESENT_LOADED" },
      { type: "PRESENT_PLAYING" },
      { type: "PRESENT_FALLBACK" },
    );
    expect(state.stage).toBe("fallback");
    expect(state.mode).toBe("static");
    // The reducer only models the presentation; the text/audio are preserved by
    // the caller, so the fallback never implies dropping an answer.
  });

  it("maps an unrecoverable error to the static error stage", () => {
    const state = apply(initialPresentationState, { type: "PRESENT_ERROR" });
    expect(state.stage).toBe("error");
    expect(state.mode).toBe("static");
  });

  it("maps an auth-expired session to the static auth-expired stage", () => {
    const busy = apply(
      initialPresentationState,
      { type: "PRESENT_START" },
      { type: "PRESENT_LOADED" },
      { type: "PRESENT_PLAYING" },
    );
    const state = apply(busy, { type: "PRESENT_AUTH_EXPIRED" });
    expect(state.stage).toBe("auth-expired");
    expect(state.mode).toBe("static");
  });

  it("maps a stream-expired session to the static stream-expired stage", () => {
    const busy = apply(
      initialPresentationState,
      { type: "PRESENT_START" },
      { type: "PRESENT_LOADED" },
      { type: "PRESENT_PLAYING" },
    );
    const state = apply(busy, { type: "PRESENT_STREAM_EXPIRED" });
    expect(state.stage).toBe("stream-expired");
    expect(state.mode).toBe("static");
  });

  it("PRESENT_RESET tears the presentation down to static/idle", () => {
    const busy = apply(
      initialPresentationState,
      { type: "PRESENT_START" },
      { type: "PRESENT_LOADED" },
      { type: "PRESENT_PLAYING" },
    );
    expect(apply(busy, { type: "PRESENT_RESET" })).toEqual(
      initialPresentationState,
    );
  });
});

describe("deriveStaticPose — natural static degradation", () => {
  it("speaks while TTS or the avatar is playing", () => {
    expect(
      deriveStaticPose({ ...idleUi, tts: "playing" }),
    ).toBe("speaking");
    expect(
      deriveStaticPose({ ...idleUi, avatar: "playing" }),
    ).toBe("speaking");
  });

  it("thinks while the answer is being generated", () => {
    expect(
      deriveStaticPose({ ...idleUi, generation: "generating" }),
    ).toBe("thinking");
    expect(
      deriveStaticPose({ ...idleUi, generation: "understanding" }),
    ).toBe("thinking");
  });

  it("listens while recording or natural conversation is active", () => {
    expect(
      deriveStaticPose({ ...idleUi, recording: "recording" }),
    ).toBe("listening");
    expect(deriveStaticPose(idleUi, { listening: true })).toBe("listening");
  });

  it("is idle when nothing is happening", () => {
    expect(deriveStaticPose(idleUi)).toBe("idle");
  });

  it("prioritises speaking over thinking over listening", () => {
    const ui: ConversationUiState = {
      generation: "generating",
      tts: "playing",
      recording: "recording",
      avatar: "idle",
      network: "online",
      restore: "idle",
    };
    expect(deriveStaticPose(ui)).toBe("speaking");
  });
});

describe("resolvePresentationParams — capability-gated parameter forwarding", () => {
  it("forwards nothing when the provider has no capabilities", () => {
    const params = resolvePresentationParams(
      { lipSync: true, emotion: true },
      noPresentationCapabilities,
    );
    expect(params).toEqual({
      syncEnabled: false,
      lipSync: false,
      emotion: false,
    });
  });

  it("forwards each capability only when the provider supports it", () => {
    const params = resolvePresentationParams(
      { lipSync: true, emotion: true },
      { audioVideoSync: true, lipSync: true, emotion: false },
    );
    expect(params).toEqual({
      syncEnabled: true,
      lipSync: true,
      emotion: false,
    });
  });

  it("never enables a capability that was not requested", () => {
    const params = resolvePresentationParams(
      { lipSync: true },
      { audioVideoSync: true, lipSync: true, emotion: true },
    );
    expect(params.emotion).toBe(false);
    expect(params.lipSync).toBe(true);
  });

  it("handles an undefined request leniently", () => {
    const params = resolvePresentationParams(
      undefined,
      { audioVideoSync: true, lipSync: true, emotion: true },
    );
    expect(params.lipSync).toBe(false);
    expect(params.emotion).toBe(false);
    expect(params.syncEnabled).toBe(true);
  });
});