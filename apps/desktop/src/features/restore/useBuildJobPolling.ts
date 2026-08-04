import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError } from "../../api/client";
import { getBuildJob } from "../creation/avatarBuildClient";
import { BuildJobSummary, normalizeJob } from "./restoreClient";

/**
 * Unified build-job polling scheduler.
 *
 * Replaces the previous fixed `setInterval` loop with a recursive `setTimeout`
 * scheduler that guarantees:
 * - at most one in-flight request per job (an in-flight request's completion
 *   schedules the next poll; a new poll is never started while one is pending),
 * - exponential backoff + random jitter for transient failures, so a single
 *   network error never marks the server-side job as failed,
 * - distinct error categories (network / timeout / server_failure / auth /
 *   not_found) so the UI can react appropriately,
 * - page-hidden throttling (poll at a low frequency) and instant refresh when
 *   the page becomes visible again,
 * - full cleanup (timers + in-flight AbortController) on settle / cancel /
 *   unmount,
 * - persistence of the polled job id so an app restart can resume it.
 */

export const BUILD_JOB_POLL_BASE_MS = 1_000;
export const BUILD_JOB_POLL_MAX_MS = 30_000;
export const BUILD_JOB_POLL_TIMEOUT_MS = 10_000;
export const BUILD_JOB_POLL_JITTER = 0.2;
export const BUILD_JOB_BACKGROUND_POLL_MS = 30_000;
export const BUILD_JOB_STORAGE_KEY = "voxstudio.build-recovery.jobId";

/** Categories of a failed poll, distinct from the server-side job state. */
export type BuildJobPollErrorKind =
  | "network" // transient connectivity failure - retryable, NOT a job failure
  | "timeout" // request exceeded the timeout - retryable
  | "server_failure" // the sidecar returned a 5xx - retryable, NOT a job failure
  | "auth" // auth invalidated - stop polling, prompt re-authorization
  | "not_found"; // the job no longer exists - stop polling

/** Structured diagnostic info surfaced in the recovery card. */
export interface BuildJobDiagnostics {
  readonly requestId: string | null;
  readonly code: string | null;
  readonly message: string | null;
  readonly retryable: boolean;
  readonly recommendedAction: string | null;
}

export interface UseBuildJobPollingOptions {
  readonly jobId: string;
  readonly initialJob?: BuildJobSummary | null;
  readonly onSettled?: (job: BuildJobSummary) => void;
}

export interface UseBuildJobPollingResult {
  /** Latest normalized job snapshot; `initialJob` until the first poll lands. */
  readonly job: BuildJobSummary | null;
  /** Current transient / terminating error category, if any. */
  readonly errorKind: BuildJobPollErrorKind | null;
  /** Structured diagnostic info (request id, recommended action). */
  readonly diagnosis: BuildJobDiagnostics | null;
  /** True while a transient error has us backing off and retrying. */
  readonly isRetrying: boolean;
  /** True while the scheduler is actively polling. */
  readonly isPolling: boolean;
  /** Force an immediate poll now ("继续检查"). */
  readonly retryNow: () => void;
  /** Stop the polling loop and clear persisted state ("取消任务"). */
  readonly cancel: () => void;
  /** Copy the latest request id to the clipboard ("复制诊断信息"). */
  readonly copyDiagnostics: () => Promise<boolean>;
}

/** Job states that end polling; the build is no longer actively progressing. */
const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  "succeeded",
  "failed",
  "cancelled",
  "cleanup_pending",
  "cleanup_failed",
]);

type StopReason = "settled" | "auth" | "not_found" | "cancelled" | "unmount";

export function readStoredBuildJobId(): string | null {
  try {
    return localStorage.getItem(BUILD_JOB_STORAGE_KEY);
  } catch {
    return null;
  }
}

function persistRemove(): void {
  try {
    localStorage.removeItem(BUILD_JOB_STORAGE_KEY);
  } catch {
    // Persistence is best-effort; ignore storage unavailability.
  }
}

function persistWrite(jobId: string): void {
  try {
    localStorage.setItem(BUILD_JOB_STORAGE_KEY, jobId);
  } catch {
    // Persistence is best-effort; ignore storage unavailability.
  }
}

/** Computes the next poll delay with exponential backoff + ±jitter. */
function backoffDelay(attempt: number, hidden: boolean): number {
  if (hidden) {
    return BUILD_JOB_BACKGROUND_POLL_MS;
  }
  const base = Math.min(
    BUILD_JOB_POLL_BASE_MS * Math.pow(2, attempt),
    BUILD_JOB_POLL_MAX_MS,
  );
  const jitter =
    1 + (Math.random() * 2 - 1) * BUILD_JOB_POLL_JITTER;
  return Math.round(base * jitter);
}

function toDiagnostics(
  caught: unknown,
  fallback: BuildJobDiagnostics,
): BuildJobDiagnostics {
  if (caught instanceof ApiError) {
    return {
      requestId: caught.requestId || null,
      code: caught.code || null,
      message: caught.message || null,
      retryable: caught.retryable,
      recommendedAction: caught.recommendedAction || null,
    };
  }
  return fallback;
}

function isAbortSignal(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "name" in err &&
    (err as { name?: unknown }).name === "AbortError"
  );
}

export function useBuildJobPolling({
  jobId,
  initialJob = null,
  onSettled,
}: UseBuildJobPollingOptions): UseBuildJobPollingResult {
  const [job, setJob] = useState<BuildJobSummary | null>(initialJob);
  const [errorKind, setErrorKind] = useState<BuildJobPollErrorKind | null>(null);
  const [diagnosis, setDiagnosis] = useState<BuildJobDiagnostics | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const [isPolling, setIsPolling] = useState(true);

  const isMountedRef = useRef(true);
  const jobIdRef = useRef(jobId);
  const onSettledRef = useRef(onSettled);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeControllerRef = useRef<AbortController | null>(null);
  const inFlightRef = useRef(false);
  const backoffRef = useRef(0);
  const hiddenRef = useRef(document.visibilityState !== "visible");
  const endedRef = useRef(false);
  const diagnosisRef = useRef<BuildJobDiagnostics | null>(null);

  onSettledRef.current = onSettled;
  jobIdRef.current = jobId;

  const clearPollTimer = useCallback(() => {
    if (pollTimerRef.current !== null) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const stop = useCallback(
    (reason: StopReason) => {
      endedRef.current = true;
      clearPollTimer();
      activeControllerRef.current?.abort();
      activeControllerRef.current = null;
      inFlightRef.current = false;
      if (reason !== "unmount") {
        setIsPolling(false);
      }
    },
    [clearPollTimer],
  );

  const scheduleNext = useCallback(
    (delay: number) => {
      if (endedRef.current) {
        return;
      }
      clearPollTimer();
      pollTimerRef.current = setTimeout(() => {
        pollTimerRef.current = null;
        requestRef.current();
      }, delay);
    },
    [clearPollTimer],
  );

  const request = useCallback(() => {
    if (endedRef.current || inFlightRef.current) {
      // Never start a second in-flight request for the same job.
      return;
    }
    const jobIdNow = jobIdRef.current;
    if (!jobIdNow) {
      return;
    }

    inFlightRef.current = true;
    const controller = new AbortController();
    activeControllerRef.current = controller;
    const timeoutId = setTimeout(
      () => controller.abort(),
      BUILD_JOB_POLL_TIMEOUT_MS,
    );

    void (async () => {
      try {
        const data = await getBuildJob(jobIdNow, controller.signal);
        if (!isMountedRef.current || controller.signal.aborted) {
          return;
        }
        const next = normalizeJob(data);
        setJob(next);
        setErrorKind(null);
        setDiagnosis(null);
        diagnosisRef.current = null;
        setIsRetrying(false);
        backoffRef.current = 0;

        if (TERMINAL_STATUSES.has(next.status)) {
          onSettledRef.current?.(next);
          persistRemove();
          stop("settled");
          return;
        }
        scheduleNext(backoffDelay(0, hiddenRef.current));
      } catch (caught) {
        if (!isMountedRef.current) {
          return;
        }
        const abortedByTimeout = controller.signal.aborted;
        let kind: BuildJobPollErrorKind;
        let diag: BuildJobDiagnostics;

        if (abortedByTimeout) {
          kind = "timeout";
          diag = {
            requestId: null,
            code: "timeout",
            message: "构建进度请求超时，正在重试。",
            retryable: true,
            recommendedAction: null,
          };
        } else if (caught instanceof ApiError && (caught.status === 401 || caught.status === 403)) {
          kind = "auth";
          diag = toDiagnostics(caught, {
            requestId: null,
            code: "auth",
            message: "鉴权已失效，请重新授权。",
            retryable: false,
            recommendedAction: null,
          });
        } else if (caught instanceof ApiError && caught.status === 404) {
          kind = "not_found";
          diag = toDiagnostics(caught, {
            requestId: null,
            code: "not_found",
            message: "构建任务已不存在。",
            retryable: false,
            recommendedAction: null,
          });
        } else if (caught instanceof ApiError && caught.status >= 500) {
          kind = "server_failure";
          diag = toDiagnostics(caught, {
            requestId: null,
            code: "server_error",
            message: "服务暂时不可用，正在重试。",
            retryable: true,
            recommendedAction: null,
          });
        } else if (isAbortSignal(caught)) {
          // Aborted by unmount/cancel; the outer guard already returned.
          return;
        } else {
          kind = "network";
          diag = toDiagnostics(caught, {
            requestId: null,
            code: "network",
            message: "网络连接中断，正在重试。",
            retryable: true,
            recommendedAction: null,
          });
        }

        setErrorKind(kind);
        setDiagnosis(diag);
        diagnosisRef.current = diag;

        if (kind === "auth" || kind === "not_found") {
          setIsRetrying(false);
          stop(kind);
          return;
        }

        setIsRetrying(true);
        const nextDelay = backoffDelay(backoffRef.current, hiddenRef.current);
        backoffRef.current += 1;
        scheduleNext(nextDelay);
      } finally {
        clearTimeout(timeoutId);
        if (activeControllerRef.current === controller) {
          activeControllerRef.current = null;
        }
        inFlightRef.current = false;
      }
    })();
  }, [scheduleNext, stop]);

  const requestRef = useRef(request);
  requestRef.current = request;

  const retryNow = useCallback(() => {
    backoffRef.current = 0;
    clearPollTimer();
    requestRef.current();
  }, [clearPollTimer]);

  const cancel = useCallback(() => {
    persistRemove();
    stop("cancelled");
  }, [stop]);

  const copyDiagnostics = useCallback(async (): Promise<boolean> => {
    const requestId = diagnosisRef.current?.requestId;
    if (!requestId) {
      return false;
    }
    try {
      await navigator.clipboard.writeText(requestId);
      return true;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    hiddenRef.current = document.visibilityState !== "visible";
    if (jobId) {
      persistWrite(jobId);
    }
    setIsPolling(true);

    const handleVisibilityChange = () => {
      hiddenRef.current = document.visibilityState !== "visible";
      if (hiddenRef.current) {
        return;
      }
      // Back on foreground: refresh immediately, then resume normal cadence.
      if (inFlightRef.current) {
        return;
      }
      backoffRef.current = 0;
      clearPollTimer();
      requestRef.current();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    requestRef.current();

    return () => {
      isMountedRef.current = false;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      clearPollTimer();
      activeControllerRef.current?.abort();
      activeControllerRef.current = null;
      inFlightRef.current = false;
      endedRef.current = true;
    };
  }, [jobId, clearPollTimer]);

  // Restart polling when the job id changes (e.g. a retry produces a new job).
  const prevJobIdRef = useRef(jobId);
  useEffect(() => {
    if (prevJobIdRef.current === jobId) {
      return;
    }
    prevJobIdRef.current = jobId;
    if (!jobId) {
      return;
    }
    endedRef.current = false;
    backoffRef.current = 0;
    inFlightRef.current = false;
    activeControllerRef.current?.abort();
    activeControllerRef.current = null;
    clearPollTimer();
    setErrorKind(null);
    setDiagnosis(null);
    diagnosisRef.current = null;
    setIsRetrying(false);
    setIsPolling(true);
    persistWrite(jobId);
    requestRef.current();
  }, [jobId, clearPollTimer]);

  return {
    job,
    errorKind,
    diagnosis,
    isRetrying,
    isPolling,
    retryNow,
    cancel,
    copyDiagnostics,
  };
}