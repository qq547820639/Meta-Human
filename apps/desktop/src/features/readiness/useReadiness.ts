import { useCallback, useEffect, useRef, useState } from "react";

import { deriveReadinessSnapshot } from "./readinessClient";
import {
  SidecarReadinessError,
  getSidecarReadinessSnapshot,
  startOrResumeSidecarReadiness,
} from "./sidecarReadinessClient";
import type {
  ReadinessRequirement,
  ReadinessSnapshot,
  ReadinessState,
  SidecarAggregateState,
  SidecarReadinessSnapshot,
} from "./types";

export const READINESS_POLL_DELAY_MS = 1_000;
export const AUTO_RETRY_MAX = 3;
export const AUTO_RETRY_DELAYS_MS = [300, 700, 1_200] as const;

interface RequestOptions {
  readonly autoRetry?: boolean;
}

export interface ReadinessSafeError {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

export interface UseReadinessResult {
  readonly snapshot: ReadinessSnapshot | null;
  readonly sidecarSnapshot: SidecarReadinessSnapshot | null;
  readonly error: ReadinessSafeError | null;
  readonly isLoading: boolean;
  readonly recommendedAction: string | null;
  readonly resume: () => void;
}

type RequestMode = "start" | "refresh";
type TimerHandle = ReturnType<typeof setTimeout>;

const POLLING_STATES: ReadonlySet<SidecarAggregateState> = new Set([
  "pending",
  "checking",
  "recovering",
]);

const outcomeStateMap: Record<SidecarAggregateState, ReadinessState> = {
  not_started: "notStarted",
  pending: "checking",
  checking: "checking",
  recovering: "checking",
  ready: "passed",
  degraded: "needsAction",
  action_required: "needsAction",
  failed: "needsAction",
  stopping: "needsAction",
};

const localActionCopy: Record<string, string> = {
  provider_not_configured:
    "请先在设置中连接本地模型、远程 GPU 和飞书知识，再重新确认准备状态。",
  provider_unavailable: "请启动本地模型服务后重试。",
  provider_timeout: "本地模型服务响应超时，请稍后重试。",
  provider_access_required: "请检查本地模型服务的访问设置。",
  invalid_provider_response: "本地模型服务返回异常，请检查后重试。",
  empty_provider_response: "请启动本地模型服务后重试。",
  stt_provider_not_configured: "请在设置中填写语音识别模型后重试。",
  feishu_authorization_required: "请授权飞书知识空间后重试。",
  knowledge_empty_wiki: "请在飞书知识空间添加文档后重试。",
  knowledge_not_searchable: "知识已同步但无法检索，请检查文档内容后重试。",
  feishu_unavailable: "飞书知识服务暂时不可用，请稍后重试。",
};

export function useReadiness(): UseReadinessResult {
  const [snapshot, setSnapshot] = useState<ReadinessSnapshot | null>(null);
  const [sidecarSnapshot, setSidecarSnapshot] =
    useState<SidecarReadinessSnapshot | null>(null);
  const [error, setError] = useState<ReadinessSafeError | null>(null);
  const [isLoading, setIsLoading] = useState(
    () => document.visibilityState === "visible",
  );
  const [recommendedAction, setRecommendedAction] = useState<string | null>(
    null,
  );

  const isMounted = useRef(false);
  const generation = useRef(0);
  const activeController = useRef<AbortController | null>(null);
  const pollTimer = useRef<TimerHandle | null>(null);
  const hasRequestedStart = useRef(false);
  const queuedResume = useRef(false);
  const hasCommittedSnapshot = useRef(false);
  const requestRef = useRef<
    (mode: RequestMode, options?: RequestOptions) => void
  >(() => undefined);
  const autoRetryCount = useRef(0);

  const clearPollTimer = useCallback(() => {
    if (pollTimer.current !== null) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  const invalidateWork = useCallback(() => {
    generation.current += 1;
    clearPollTimer();
    activeController.current?.abort();
    activeController.current = null;
  }, [clearPollTimer]);

  const request = useCallback(
    (mode: RequestMode, options?: RequestOptions) => {
      invalidateWork();
      if (!options?.autoRetry) {
        autoRetryCount.current = 0;
      }
      const requestGeneration = generation.current;
      const controller = new AbortController();
      activeController.current = controller;
      if (mode === "start") {
        hasRequestedStart.current = true;
      }

      setError(null);
      setRecommendedAction(null);
      setIsLoading(!hasCommittedSnapshot.current);
      setSnapshot((current) =>
        current === null ? null : { ...current, canCreate: false },
      );

      const requestPromise =
        mode === "start"
          ? startOrResumeSidecarReadiness(controller.signal)
          : getSidecarReadinessSnapshot(controller.signal);

      void requestPromise
        .then(async (nextSidecarSnapshot) => {
          if (!isCurrentRequest(requestGeneration, controller)) {
            return;
          }

          const requirements = mapOutcomes(nextSidecarSnapshot);
          const rustSnapshot = await deriveReadinessSnapshot(requirements);
          if (!isCurrentRequest(requestGeneration, controller)) {
            return;
          }

          autoRetryCount.current = 0;
          hasCommittedSnapshot.current = true;
          setSidecarSnapshot(nextSidecarSnapshot);
          setSnapshot({
            requirements: rustSnapshot.requirements,
            canCreate:
              nextSidecarSnapshot.gate_open && rustSnapshot.canCreate,
          });
          setError(null);
          setIsLoading(false);
          setRecommendedAction(firstRecommendedAction(nextSidecarSnapshot));

          if (
            document.visibilityState === "visible" &&
            POLLING_STATES.has(nextSidecarSnapshot.state)
          ) {
            pollTimer.current = setTimeout(() => {
              pollTimer.current = null;
              requestRef.current("refresh");
            }, READINESS_POLL_DELAY_MS);
          }
        })
        .catch((caught: unknown) => {
          if (
            !isCurrentRequest(requestGeneration, controller) ||
            isAbortError(caught)
          ) {
            return;
          }

          const safeError = toSafeError(caught);
          if (
            safeError.retryable &&
            !hasCommittedSnapshot.current &&
            document.visibilityState === "visible" &&
            autoRetryCount.current < AUTO_RETRY_MAX
          ) {
            const delay = AUTO_RETRY_DELAYS_MS[autoRetryCount.current];
            autoRetryCount.current += 1;
            pollTimer.current = setTimeout(() => {
              pollTimer.current = null;
              requestRef.current("start", { autoRetry: true });
            }, delay);
            return;
          }

          autoRetryCount.current = 0;
          setSnapshot((current) =>
            current === null ? null : { ...current, canCreate: false },
          );
          setError(safeError);
          setIsLoading(false);
          setRecommendedAction(
            caught instanceof SidecarReadinessError
              ? caught.recommendedAction
              : null,
          );
        })
        .finally(() => {
          if (activeController.current === controller) {
            activeController.current = null;
          }
        });
    },
    [invalidateWork],
  );

  requestRef.current = request;

  function isCurrentRequest(
    requestGeneration: number,
    controller: AbortController,
  ): boolean {
    return (
      isMounted.current &&
      generation.current === requestGeneration &&
      !controller.signal.aborted
    );
  }

  useEffect(() => {
    isMounted.current = true;

    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        invalidateWork();
        setSnapshot((current) =>
          current === null ? null : { ...current, canCreate: false },
        );
        setIsLoading(false);
        return;
      }

      const shouldStart = queuedResume.current || !hasRequestedStart.current;
      queuedResume.current = false;
      requestRef.current(shouldStart ? "start" : "refresh");
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    if (document.visibilityState === "visible") {
      requestRef.current("start");
    }

    return () => {
      isMounted.current = false;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      invalidateWork();
    };
  }, [invalidateWork]);

  const resume = useCallback(() => {
    if (document.visibilityState !== "visible") {
      queuedResume.current = true;
      return;
    }

    queuedResume.current = false;
    requestRef.current("start");
  }, []);

  return {
    snapshot,
    sidecarSnapshot,
    error,
    isLoading,
    recommendedAction,
    resume,
  };
}

function mapOutcomes(
  snapshot: SidecarReadinessSnapshot,
): readonly ReadinessRequirement[] {
  return snapshot.outcomes.map((outcome) => ({
    id: outcome.id,
    required: outcome.required,
    state: outcomeStateMap[outcome.state],
  }));
}

function firstRecommendedAction(
  snapshot: SidecarReadinessSnapshot,
): string | null {
  for (const capability of snapshot.capabilities) {
    if (!capability.required) {
      continue;
    }
    const error = capability.error;
    if (!error) {
      continue;
    }
    const mappedAction = localActionCopy[error.code];
    if (mappedAction) {
      return mappedAction;
    }
    const action = error.recommended_action?.trim();
    if (action) {
      return action;
    }
  }
  return null;
}

function toSafeError(caught: unknown): ReadinessSafeError {
  if (caught instanceof SidecarReadinessError) {
    return {
      code: caught.code,
      message:
        caught.code === "readiness_unavailable"
          ? "无法确认工作室准备状态。"
          : caught.message,
      retryable: caught.retryable,
    };
  }

  return {
    code: "readiness_unavailable",
    message: "无法确认工作室准备状态。",
    retryable: true,
  };
}

function isAbortError(caught: unknown): boolean {
  return (
    typeof caught === "object" &&
    caught !== null &&
    "name" in caught &&
    caught.name === "AbortError"
  );
}
