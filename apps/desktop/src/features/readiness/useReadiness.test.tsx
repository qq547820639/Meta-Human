import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { deriveReadinessSnapshot } from "./readinessClient";
import {
  SidecarReadinessError,
  getSidecarReadinessSnapshot,
  startOrResumeSidecarReadiness,
} from "./sidecarReadinessClient";
import type {
  ReadinessRequirement,
  ReadinessSnapshot,
  SidecarAggregateState,
  SidecarReadinessSnapshot,
} from "./types";
import {
  AUTO_RETRY_DELAYS_MS,
  AUTO_RETRY_MAX,
  READINESS_POLL_DELAY_MS,
  useReadiness,
} from "./useReadiness";

vi.mock("./readinessClient", () => ({
  deriveReadinessSnapshot: vi.fn(),
}));

vi.mock("./sidecarReadinessClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./sidecarReadinessClient")>()),
  getSidecarReadinessSnapshot: vi.fn(),
  startOrResumeSidecarReadiness: vi.fn(),
}));

const requirementIds = [
  "conversation",
  "voicePresence",
  "knowledge",
] as const;

function makeSidecarSnapshot(
  state: SidecarAggregateState,
  {
    gateOpen = state === "ready",
    id = `run-${state}`,
    outcomeStates = [state, state, state],
    recommendedActions = [],
    errorCodes = [],
    capabilityRequired = [],
  }: {
    gateOpen?: boolean;
    id?: string;
    outcomeStates?: readonly SidecarAggregateState[];
    recommendedActions?: readonly string[];
    errorCodes?: readonly string[];
    capabilityRequired?: readonly boolean[];
  } = {},
): SidecarReadinessSnapshot {
  const errorCount = Math.max(
    recommendedActions.length,
    errorCodes.length,
  );
  return {
    id,
    state,
    gate_open: gateOpen,
    outcomes: requirementIds.map((outcomeId, index) => ({
      id: outcomeId,
      required: true,
      state: outcomeStates[index] ?? state,
      capabilities: [],
    })),
    capabilities: Array.from({ length: errorCount }, (_, index) => ({
      id: index === 0 ? "llm.chat" : "embedding.text",
      required: capabilityRequired[index] ?? true,
      state: "action_required",
      attempts: 1,
      safe_detail: "This capability needs attention.",
      error: {
        code: errorCodes[index] ?? `action-${index}`,
        message: "A safe capability error.",
        retryable: true,
        recommended_action: recommendedActions[index] ?? null,
      },
      created_at: "2026-08-01T09:30:00Z",
      updated_at: "2026-08-01T09:30:00Z",
    })),
    created_at: "2026-08-01T09:30:00Z",
    updated_at: "2026-08-01T09:30:00Z",
    completed_at: state === "ready" ? "2026-08-01T09:31:00Z" : null,
  };
}

function derivedSnapshot(
  requirements: readonly ReadinessRequirement[],
  canCreate: boolean,
): ReadinessSnapshot {
  return { requirements, canCreate };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useReadiness", () => {
  let visibility: DocumentVisibilityState;

  beforeEach(() => {
    vi.useFakeTimers();
    visibility = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(
      () => visibility,
    );
    vi.mocked(getSidecarReadinessSnapshot).mockReset();
    vi.mocked(startOrResumeSidecarReadiness).mockReset();
    vi.mocked(deriveReadinessSnapshot).mockReset();
    vi.mocked(deriveReadinessSnapshot).mockImplementation(
      async (requirements) =>
        derivedSnapshot(
          requirements,
          requirements.length === 3 &&
            requirements.every(
              (requirement) =>
                requirement.required && requirement.state === "passed",
            ),
        ),
    );
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("starts or resumes on the first visible mount and exposes loading honestly", async () => {
    const start = deferred<SidecarReadinessSnapshot>();
    vi.mocked(startOrResumeSidecarReadiness).mockReturnValue(start.promise);

    const { result } = renderHook(() => useReadiness());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.snapshot).toBeNull();
    expect(startOrResumeSidecarReadiness).toHaveBeenCalledTimes(1);
    const signal = vi.mocked(startOrResumeSidecarReadiness).mock.calls[0][0];
    expect(signal).toBeInstanceOf(AbortSignal);

    start.resolve(makeSidecarSnapshot("checking"));
    await flushPromises();

    expect(result.current.isLoading).toBe(false);
    expect(result.current.snapshot?.canCreate).toBe(false);
  });

  it.each(["pending", "checking", "recovering"] as const)(
    "polls recursively while the top-level state is %s",
    async (state) => {
      vi.mocked(startOrResumeSidecarReadiness).mockResolvedValue(
        makeSidecarSnapshot(state),
      );
      vi.mocked(getSidecarReadinessSnapshot).mockResolvedValue(
        makeSidecarSnapshot("ready"),
      );

      renderHook(() => useReadiness());
      await flushPromises();
      expect(getSidecarReadinessSnapshot).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(READINESS_POLL_DELAY_MS);
      });

      expect(getSidecarReadinessSnapshot).toHaveBeenCalledTimes(1);
      expect(
        vi.mocked(getSidecarReadinessSnapshot).mock.calls[0][0],
      ).toBeInstanceOf(AbortSignal);
    },
  );

  it.each([
    "ready",
    "action_required",
    "degraded",
    "failed",
    "not_started",
    "stopping",
  ] as const)("stops polling for terminal state %s", async (state) => {
    vi.mocked(startOrResumeSidecarReadiness).mockResolvedValue(
      makeSidecarSnapshot(state),
    );

    renderHook(() => useReadiness());
    await flushPromises();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(READINESS_POLL_DELAY_MS * 3);
    });

    expect(getSidecarReadinessSnapshot).not.toHaveBeenCalled();
  });

  it.each([
    ["not_started", "notStarted"],
    ["pending", "checking"],
    ["checking", "checking"],
    ["recovering", "checking"],
    ["ready", "passed"],
    ["degraded", "needsAction"],
    ["action_required", "needsAction"],
    ["failed", "needsAction"],
    ["stopping", "needsAction"],
  ] as const)("maps Sidecar outcome %s to Rust state %s", async (wire, mapped) => {
    vi.mocked(startOrResumeSidecarReadiness).mockResolvedValue(
      makeSidecarSnapshot(wire),
    );

    renderHook(() => useReadiness());
    await flushPromises();

    expect(deriveReadinessSnapshot).toHaveBeenCalledWith(
      requirementIds.map((id) => ({ id, required: true, state: mapped })),
    );
  });

  it.each([
    [false, false, false],
    [false, true, false],
    [true, false, false],
    [true, true, true],
  ] as const)(
    "conjoins Sidecar gate %s and Rust gate %s to %s",
    async (sidecarGate, rustGate, expected) => {
      const sidecar = makeSidecarSnapshot("ready", {
        gateOpen: sidecarGate,
      });
      vi.mocked(startOrResumeSidecarReadiness).mockResolvedValue(sidecar);
      vi.mocked(deriveReadinessSnapshot).mockImplementation(
        async (requirements) => derivedSnapshot(requirements, rustGate),
      );

      const { result } = renderHook(() => useReadiness());
      await flushPromises();

      expect(result.current.snapshot?.canCreate).toBe(expected);
      expect(result.current.sidecarSnapshot).toEqual(sidecar);
    },
  );

  it("makes no hidden-mount request and uses POST on first visibility", async () => {
    visibility = "hidden";
    vi.mocked(startOrResumeSidecarReadiness).mockResolvedValue(
      makeSidecarSnapshot("not_started"),
    );

    renderHook(() => useReadiness());
    expect(startOrResumeSidecarReadiness).not.toHaveBeenCalled();
    expect(getSidecarReadinessSnapshot).not.toHaveBeenCalled();

    visibility = "visible";
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await flushPromises();

    expect(startOrResumeSidecarReadiness).toHaveBeenCalledTimes(1);
    expect(getSidecarReadinessSnapshot).not.toHaveBeenCalled();
  });

  it("aborts hidden work and refreshes immediately with GET when visible again", async () => {
    const stalePoll = deferred<SidecarReadinessSnapshot>();
    vi.mocked(startOrResumeSidecarReadiness).mockResolvedValue(
      makeSidecarSnapshot("checking"),
    );
    vi.mocked(getSidecarReadinessSnapshot)
      .mockReturnValueOnce(stalePoll.promise)
      .mockResolvedValueOnce(makeSidecarSnapshot("ready", { id: "fresh" }));

    const { result } = renderHook(() => useReadiness());
    await flushPromises();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(READINESS_POLL_DELAY_MS);
    });
    const staleSignal = vi.mocked(getSidecarReadinessSnapshot).mock.calls[0][0];

    visibility = "hidden";
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(staleSignal?.aborted).toBe(true);

    visibility = "visible";
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await flushPromises();

    expect(getSidecarReadinessSnapshot).toHaveBeenCalledTimes(2);
    expect(result.current.sidecarSnapshot?.id).toBe("fresh");

    stalePoll.resolve(makeSidecarSnapshot("failed", { id: "stale" }));
    await flushPromises();
    expect(result.current.sidecarSnapshot?.id).toBe("fresh");
  });

  it("invalidates a stale Rust derivation across a visibility transition", async () => {
    const staleRust = deferred<ReadinessSnapshot>();
    const staleSidecar = makeSidecarSnapshot("checking", { id: "stale" });
    const freshSidecar = makeSidecarSnapshot("ready", { id: "fresh" });
    const staleRequirements: readonly ReadinessRequirement[] = requirementIds.map(
      (id) => ({ id, required: true, state: "checking" }),
    );
    const freshRequirements: readonly ReadinessRequirement[] = requirementIds.map(
      (id) => ({ id, required: true, state: "passed" }),
    );
    vi.mocked(startOrResumeSidecarReadiness).mockResolvedValue(staleSidecar);
    vi.mocked(getSidecarReadinessSnapshot).mockResolvedValue(freshSidecar);
    vi.mocked(deriveReadinessSnapshot)
      .mockReturnValueOnce(staleRust.promise)
      .mockResolvedValueOnce(derivedSnapshot(freshRequirements, true));

    const { result } = renderHook(() => useReadiness());
    await flushPromises();
    expect(deriveReadinessSnapshot).toHaveBeenCalledTimes(1);

    visibility = "hidden";
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    visibility = "visible";
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await flushPromises();

    expect(result.current.sidecarSnapshot?.id).toBe("fresh");
    expect(result.current.snapshot?.canCreate).toBe(true);

    staleRust.resolve(derivedSnapshot(staleRequirements, false));
    await flushPromises();
    expect(result.current.sidecarSnapshot?.id).toBe("fresh");
    expect(result.current.snapshot?.canCreate).toBe(true);
  });

  it("queues an explicit hidden resume and POSTs as soon as visible", async () => {
    visibility = "hidden";
    vi.mocked(startOrResumeSidecarReadiness).mockResolvedValue(
      makeSidecarSnapshot("action_required"),
    );
    const { result } = renderHook(() => useReadiness());

    act(() => result.current.resume());
    expect(startOrResumeSidecarReadiness).not.toHaveBeenCalled();

    visibility = "visible";
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await flushPromises();
    expect(startOrResumeSidecarReadiness).toHaveBeenCalledTimes(1);
  });

  it("uses POST for an explicit visible resume", async () => {
    vi.mocked(startOrResumeSidecarReadiness).mockResolvedValue(
      makeSidecarSnapshot("action_required"),
    );
    const { result } = renderHook(() => useReadiness());
    await flushPromises();

    act(() => result.current.resume());
    await flushPromises();

    expect(startOrResumeSidecarReadiness).toHaveBeenCalledTimes(2);
    expect(getSidecarReadinessSnapshot).not.toHaveBeenCalled();
  });

  it("returns at most one safe recommended action", async () => {
    vi.mocked(startOrResumeSidecarReadiness).mockResolvedValue(
      makeSidecarSnapshot("action_required", {
        recommendedActions: [
          "Allow microphone access in System Settings.",
          "Authorize knowledge access.",
        ],
      }),
    );

    const { result } = renderHook(() => useReadiness());
    await flushPromises();

    expect(result.current.recommendedAction).toBe(
      "Allow microphone access in System Settings.",
    );
    expect(result.current.recommendedAction).not.toContain(
      "Authorize knowledge access.",
    );
  });

  it("ignores recovery actions from optional capabilities", async () => {
    vi.mocked(startOrResumeSidecarReadiness).mockResolvedValue(
      makeSidecarSnapshot("action_required", {
        recommendedActions: [
          "Optional capability action should be ignored.",
          "Required capability action.",
        ],
        capabilityRequired: [false, true],
      }),
    );

    const { result } = renderHook(() => useReadiness());
    await flushPromises();

    expect(result.current.recommendedAction).toBe(
      "Required capability action.",
    );
  });

  it("maps local provider readiness codes to one Chinese recovery action", async () => {
    vi.mocked(startOrResumeSidecarReadiness).mockResolvedValue(
      makeSidecarSnapshot("action_required", {
        errorCodes: ["provider_unavailable"],
        recommendedActions: ["English fallback should not be used"],
      }),
    );

    const { result } = renderHook(() => useReadiness());
    await flushPromises();

    expect(result.current.recommendedAction).toBe(
      "请启动本地模型服务后重试。",
    );
  });

  it("maps Feishu authorization codes to one Chinese recovery action", async () => {
    vi.mocked(startOrResumeSidecarReadiness).mockResolvedValue(
      makeSidecarSnapshot("action_required", {
        errorCodes: ["feishu_authorization_required"],
        recommendedActions: ["English fallback should not be used"],
      }),
    );

    const { result } = renderHook(() => useReadiness());
    await flushPromises();

    expect(result.current.recommendedAction).toBe(
      "请授权飞书知识空间后重试。",
    );
  });

  it("auto-retries a retryable startup failure before surfacing an error", async () => {
    const unavailable = new SidecarReadinessError({
      status: null,
      code: "readiness_unavailable",
      message: "The readiness service is unavailable.",
      retryable: true,
    });
    vi.mocked(startOrResumeSidecarReadiness)
      .mockRejectedValueOnce(unavailable)
      .mockRejectedValueOnce(unavailable)
      .mockResolvedValueOnce(makeSidecarSnapshot("checking"));

    const { result } = renderHook(() => useReadiness());
    await flushPromises();

    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(true);
    expect(startOrResumeSidecarReadiness).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_RETRY_DELAYS_MS[0]);
      await Promise.resolve();
    });
    await flushPromises();
    expect(startOrResumeSidecarReadiness).toHaveBeenCalledTimes(2);
    expect(result.current.error).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_RETRY_DELAYS_MS[1]);
      await Promise.resolve();
    });
    await flushPromises();

    expect(startOrResumeSidecarReadiness).toHaveBeenCalledTimes(3);
    expect(result.current.error).toBeNull();
    expect(result.current.snapshot?.canCreate).toBe(false);
  });

  it("surfaces the safe error only after bounded startup retries are exhausted", async () => {
    const unavailable = new SidecarReadinessError({
      status: null,
      code: "readiness_unavailable",
      message: "The readiness service is unavailable.",
      retryable: true,
    });
    vi.mocked(startOrResumeSidecarReadiness).mockRejectedValue(unavailable);

    const { result } = renderHook(() => useReadiness());
    await flushPromises();
    expect(startOrResumeSidecarReadiness).toHaveBeenCalledTimes(1);

    for (const delay of AUTO_RETRY_DELAYS_MS) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(delay);
        await Promise.resolve();
      });
      await flushPromises();
    }

    expect(startOrResumeSidecarReadiness).toHaveBeenCalledTimes(
      AUTO_RETRY_MAX + 1,
    );
    expect(result.current.isLoading).toBe(false);
    expect(result.current.snapshot).toBeNull();
    expect(result.current.error).toMatchObject({
      code: "readiness_unavailable",
      message: "无法确认工作室准备状态。",
      retryable: true,
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("returns a fixed safe error and fails closed for non-retryable failures", async () => {
    vi.mocked(startOrResumeSidecarReadiness).mockRejectedValue(
      new SidecarReadinessError({
        status: null,
        code: "readiness_failed_closed",
        message: "The readiness service stopped.",
        retryable: false,
      }),
    );

    const { result } = renderHook(() => useReadiness());
    await flushPromises();

    expect(result.current.isLoading).toBe(false);
    expect(result.current.snapshot).toBeNull();
    expect(result.current.error).toMatchObject({
      code: "readiness_failed_closed",
      message: "The readiness service stopped.",
      retryable: false,
    });
  });

  it("removes visibility work and aborts the active request on unmount", () => {
    const request = deferred<SidecarReadinessSnapshot>();
    vi.mocked(startOrResumeSidecarReadiness).mockReturnValue(request.promise);
    const removeListener = vi.spyOn(document, "removeEventListener");

    const { unmount } = renderHook(() => useReadiness());
    const signal = vi.mocked(startOrResumeSidecarReadiness).mock.calls[0][0];
    unmount();

    expect(signal?.aborted).toBe(true);
    expect(removeListener).toHaveBeenCalledWith(
      "visibilitychange",
      expect.any(Function),
    );
    expect(vi.getTimerCount()).toBe(0);
  });
});
