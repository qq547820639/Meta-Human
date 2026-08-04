import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../api/client";
import type { BuildJobData } from "../../api/contracts";
import { getBuildJob } from "../creation/avatarBuildClient";
import type { BuildJobSummary } from "./restoreClient";
import { BUILD_JOB_STORAGE_KEY, useBuildJobPolling } from "./useBuildJobPolling";

vi.mock("../creation/avatarBuildClient", () => ({
  getBuildJob: vi.fn(),
}));

const runningData: BuildJobData = {
  id: "job-1",
  status: "running",
  current_stage: "enroll_voice",
  stage_progress: "正在注册声音",
  succeeded_stages: ["validate_inputs"],
  retry_count: 0,
  error_code: null,
  error_detail: null,
  cancelled: false,
  digital_human_id: "human-1",
  created_at: "2026-08-04T11:00:00Z",
  updated_at: "2026-08-04T12:00:00Z",
  completed_at: null,
};

function jobData(overrides: Partial<BuildJobData>): BuildJobData {
  return { ...runningData, ...overrides };
}

const runningSummary: BuildJobSummary = {
  id: "job-1",
  status: "running",
  stage: "enroll_voice",
  stageProgress: "正在注册声音",
  succeededStages: ["validate_inputs"],
  retryCount: 0,
  errorCode: null,
  errorDetail: null,
  cancelled: false,
  updatedAt: "2026-08-04T12:00:00Z",
  createdAt: "2026-08-04T11:00:00Z",
  completedAt: null,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

/** jsdom here exposes no global `localStorage`; install an in-memory stub. */
function installLocalStorage(): void {
  const store = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key) => store.get(key) ?? null,
    key: (index) => Array.from(store.keys())[index] ?? null,
    removeItem: (key) => {
      store.delete(key);
    },
    setItem: (key, value) => {
      store.set(key, String(value));
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
  });
}

// Deterministic backoff: Math.random() = 0.5 makes the ±20% jitter factor 1.0.
beforeEach(() => {
  vi.useFakeTimers();
  installLocalStorage();
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  vi.mocked(getBuildJob).mockReset();
  localStorage.clear();
  Object.defineProperty(document, "visibilityState", {
    value: "visible",
    configurable: true,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("useBuildJobPolling", () => {
  it("never starts an overlapping request while one is in flight", async () => {
    const first = deferred<BuildJobData>();
    vi.mocked(getBuildJob).mockReturnValueOnce(first.promise);
    vi.mocked(getBuildJob).mockResolvedValueOnce(jobData({}));

    renderHook(() =>
      useBuildJobPolling({ jobId: "job-1", initialJob: runningSummary }),
    );
    await flush();

    expect(getBuildJob).toHaveBeenCalledTimes(1);
    // The first request is still pending; advancing time must not fire a second.
    await act(async () => {
      vi.advanceTimersByTime(2_000);
    });
    expect(getBuildJob).toHaveBeenCalledTimes(1);

    // Resolve the in-flight request (running, non-terminal) -> schedules next.
    await act(async () => {
      first.resolve(jobData({}));
      await Promise.resolve();
    });
    await flush();
    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    await flush();

    expect(getBuildJob).toHaveBeenCalledTimes(2);
  });

  it("retries with backoff after a network error without marking the job failed", async () => {
    vi.mocked(getBuildJob).mockRejectedValueOnce(
      new TypeError("Failed to fetch"),
    );
    vi.mocked(getBuildJob).mockResolvedValueOnce(jobData({}));

    const { result } = renderHook(() =>
      useBuildJobPolling({ jobId: "job-1", initialJob: runningSummary }),
    );
    await flush();

    expect(result.current.errorKind).toBe("network");
    expect(result.current.isRetrying).toBe(true);
    // A network error must not turn the server-side job into "failed".
    expect(result.current.job?.status).toBe("running");

    // Backoff attempt 0 -> 1000ms (jitter factor 1.0).
    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    await flush();

    expect(result.current.errorKind).toBeNull();
    expect(result.current.isRetrying).toBe(false);
    expect(getBuildJob).toHaveBeenCalledTimes(2);
  });

  it("stops polling and cleans up timers once the job completes", async () => {
    const onSettled = vi.fn();
    vi.mocked(getBuildJob).mockResolvedValueOnce(jobData({})); // running
    vi.mocked(getBuildJob).mockResolvedValueOnce(
      jobData({ status: "succeeded" }),
    );

    renderHook(() =>
      useBuildJobPolling({
        jobId: "job-1",
        initialJob: runningSummary,
        onSettled,
      }),
    );
    await flush();
    expect(getBuildJob).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    await flush();

    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(onSettled).toHaveBeenCalledWith(
      expect.objectContaining({ status: "succeeded" }),
    );

    // No further polls after settling.
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(getBuildJob).toHaveBeenCalledTimes(2);
  });

  it("stops issuing new requests after cancel()", async () => {
    vi.mocked(getBuildJob).mockResolvedValue(jobData({}));

    const { result } = renderHook(() =>
      useBuildJobPolling({ jobId: "job-1", initialJob: runningSummary }),
    );
    await flush();
    expect(getBuildJob).toHaveBeenCalledTimes(1);

    act(() => result.current.cancel());
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });

    expect(getBuildJob).toHaveBeenCalledTimes(1);
  });

  it("cleans up timers and stops polling on unmount", async () => {
    vi.mocked(getBuildJob).mockResolvedValue(jobData({}));

    const { unmount } = renderHook(() =>
      useBuildJobPolling({ jobId: "job-1", initialJob: runningSummary }),
    );
    await flush();
    expect(getBuildJob).toHaveBeenCalledTimes(1);

    unmount();
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });

    expect(getBuildJob).toHaveBeenCalledTimes(1);
  });

  it("throttles polling while hidden and refreshes immediately on return", async () => {
    vi.mocked(getBuildJob).mockResolvedValue(jobData({}));

    renderHook(() =>
      useBuildJobPolling({ jobId: "job-1", initialJob: runningSummary }),
    );
    await flush();
    expect(getBuildJob).toHaveBeenCalledTimes(1);

    // Hide: the pre-hide 1000ms timer fires poll #2, then hidden schedules 30s.
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      configurable: true,
    });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    await flush();
    expect(getBuildJob).toHaveBeenCalledTimes(2);

    // Only 2s since poll #2; the next poll is 30s away, so nothing fires.
    await act(async () => {
      vi.advanceTimersByTime(2_000);
    });
    expect(getBuildJob).toHaveBeenCalledTimes(2);

    // Reach 30s since poll #2 -> poll #3.
    await act(async () => {
      vi.advanceTimersByTime(28_000);
    });
    await flush();
    expect(getBuildJob).toHaveBeenCalledTimes(3);

    // Return to foreground -> immediate refresh.
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await flush();
    expect(getBuildJob).toHaveBeenCalledTimes(4);
  });

  it("classifies network and server failures distinctly", async () => {
    vi.mocked(getBuildJob).mockRejectedValueOnce(
      new TypeError("network down"),
    );

    const { result } = renderHook(() =>
      useBuildJobPolling({ jobId: "job-1", initialJob: runningSummary }),
    );
    await flush();
    expect(result.current.errorKind).toBe("network");
    expect(result.current.diagnosis?.retryable).toBe(true);

    // Next attempt (backoff attempt 1 -> 2000ms) hits a 5xx server failure.
    vi.mocked(getBuildJob).mockRejectedValueOnce(
      new ApiError(
        {
          code: "server_error",
          message: "boom",
          retryable: true,
          request_id: "req-1",
          recommended_action: null,
          technical_message: null,
          details: null,
          provider: null,
          provider_status: null,
          timestamp: null,
        },
        500,
      ),
    );
    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    await flush();

    expect(result.current.errorKind).toBe("server_failure");
    expect(result.current.diagnosis?.retryable).toBe(true);
    expect(result.current.diagnosis?.requestId).toBe("req-1");
  });

  it("persists the job id and clears it once the job settles", async () => {
    vi.mocked(getBuildJob).mockResolvedValueOnce(jobData({})); // running
    vi.mocked(getBuildJob).mockResolvedValueOnce(
      jobData({ status: "succeeded" }),
    );

    renderHook(() =>
      useBuildJobPolling({ jobId: "job-1", initialJob: runningSummary }),
    );
    await flush();
    expect(localStorage.getItem(BUILD_JOB_STORAGE_KEY)).toBe("job-1");

    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    await flush();

    expect(localStorage.getItem(BUILD_JOB_STORAGE_KEY)).toBeNull();
  });
});