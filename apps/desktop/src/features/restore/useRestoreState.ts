import { useCallback, useEffect, useState } from "react";

import {
  BuildJobSummary,
  ConversationSummary,
  DigitalHumanSummary,
  RestoreErrorKind,
  fetchDefaultHuman,
  fetchRecentConversation,
  fetchResumableBuildJob,
} from "./restoreClient";

export type RestoreStatus =
  | "loading"
  | "success"
  | "empty"
  | "error"
  | "retry";

export interface RestoreState {
  readonly defaultHuman: DigitalHumanSummary | null;
  readonly recentConversation: ConversationSummary | null;
  readonly resumableJob: BuildJobSummary | null;
  readonly status: RestoreStatus;
  readonly errorKind?: RestoreErrorKind;
  readonly isLoading: boolean;
  readonly retry: () => void;
}

/**
 * Queries the backend for the current state so the app can restore a ready
 * digital human, the most recent conversation, and any unfinished build job.
 *
 * The outcome is summarized in `status`:
 * - "loading" during the initial load
 * - "retry" while a user-triggered retry is in flight
 * - "success" when at least one piece of data was restored
 * - "empty" when every fetch succeeded but returned no data
 * - "error" when any fetch failed for a reason other than "no data"
 *
 * `errorKind` distinguishes sidecar / auth / parse / database / network
 * failures so a sidecar outage or auth failure is never masked as "empty".
 */
export function useRestoreState(): RestoreState {
  const [defaultHuman, setDefaultHuman] =
    useState<DigitalHumanSummary | null>(null);
  const [recentConversation, setRecentConversation] =
    useState<ConversationSummary | null>(null);
  const [resumableJob, setResumableJob] =
    useState<BuildJobSummary | null>(null);
  const [status, setStatus] = useState<RestoreStatus>("loading");
  const [errorKind, setErrorKind] = useState<RestoreErrorKind | undefined>(
    undefined,
  );
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setStatus(attempt === 0 ? "loading" : "retry");
    setErrorKind(undefined);
    void Promise.all([
      fetchDefaultHuman(),
      fetchRecentConversation(),
      fetchResumableBuildJob(),
    ]).then(([human, conversation, job]) => {
      if (!active) {
        return;
      }
      setDefaultHuman(human.ok ? human.data : null);
      setRecentConversation(conversation.ok ? conversation.data : null);
      setResumableJob(job.ok ? job.data : null);

      if (!human.ok) {
        setStatus("error");
        setErrorKind(human.error);
        return;
      }
      if (!conversation.ok) {
        setStatus("error");
        setErrorKind(conversation.error);
        return;
      }
      if (!job.ok) {
        setStatus("error");
        setErrorKind(job.error);
        return;
      }

      const hasData =
        human.data !== null ||
        conversation.data !== null ||
        job.data !== null;
      setStatus(hasData ? "success" : "empty");
    });
    return () => {
      active = false;
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);

  return {
    defaultHuman,
    recentConversation,
    resumableJob,
    status,
    errorKind,
    isLoading: status === "loading" || status === "retry",
    retry,
  };
}