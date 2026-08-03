import { useEffect, useState } from "react";

import {
  BuildJobSummary,
  ConversationSummary,
  DigitalHumanSummary,
  fetchDefaultHuman,
  fetchRecentConversation,
  fetchResumableBuildJob,
} from "./restoreClient";

export interface RestoreState {
  readonly defaultHuman: DigitalHumanSummary | null;
  readonly recentConversation: ConversationSummary | null;
  readonly resumableJob: BuildJobSummary | null;
  readonly isLoading: boolean;
}

/**
 * Queries the backend for the current state so the app can restore a ready
 * digital human, the most recent conversation, and any unfinished build job.
 * Every fetch degrades to null on failure, so the app always falls back to the
 * normal startup flow when the endpoints are unreachable.
 */
export function useRestoreState(): RestoreState {
  const [defaultHuman, setDefaultHuman] =
    useState<DigitalHumanSummary | null>(null);
  const [recentConversation, setRecentConversation] =
    useState<ConversationSummary | null>(null);
  const [resumableJob, setResumableJob] =
    useState<BuildJobSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void Promise.all([
      fetchDefaultHuman(),
      fetchRecentConversation(),
      fetchResumableBuildJob(),
    ]).then(([human, conversation, job]) => {
      if (!active) {
        return;
      }
      setDefaultHuman(human);
      setRecentConversation(conversation);
      setResumableJob(job);
      setIsLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  return { defaultHuman, recentConversation, resumableJob, isLoading };
}