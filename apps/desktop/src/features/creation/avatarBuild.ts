import type { BuildJobData, BuildJobStatus } from "../../api/contracts";

/**
 * UI build stage. It is a deliberately coarse projection of the authoritative
 * backend `BuildJobResponse.status` (see `routes/avatar.py`), so the UI never
 * fakes progress and never cancels by aborting a local fetch. Cancellation is
 * a server-side state transition (`cancelling` -> `cancelled`).
 */
export type BuildStage =
  | "idle"
  | "validating"
  | "submitting"
  | "building"
  | "cancelling"
  | "cancelled"
  | "ready"
  | "failed"
  | "cleanup";

export interface AvatarBuildState {
  readonly stage: BuildStage;
  readonly error: string | null;
  readonly job: BuildJobData | null;
  readonly digitalHumanId: string | null;
  readonly voiceId: string | null;
  readonly avatarId: string | null;
}

export const initialAvatarBuildState: AvatarBuildState = {
  stage: "idle",
  error: null,
  job: null,
  digitalHumanId: null,
  voiceId: null,
  avatarId: null,
};

/** Maps the authoritative backend job status to the coarser UI stage. */
export function stageFromJobStatus(status: BuildJobStatus): BuildStage {
  switch (status) {
    case "pending":
    case "running":
      return "building";
    case "succeeded":
      return "ready";
    case "failed":
      return "failed";
    case "cancelling":
      return "cancelling";
    case "cancelled":
      return "cancelled";
    case "cleanup_pending":
    case "cleanup_failed":
      return "cleanup";
  }
}

export function startBuild(state: AvatarBuildState): AvatarBuildState {
  return { ...state, stage: "validating", error: null };
}

export function validationSucceeded(
  state: AvatarBuildState,
): AvatarBuildState {
  if (state.stage !== "validating") {
    return state;
  }
  return { ...state, stage: "submitting", error: null };
}

/** Records the accepted job (202) and enters the build/polling state. */
export function jobAccepted(
  state: AvatarBuildState,
  job: BuildJobData,
): AvatarBuildState {
  return {
    ...state,
    stage: stageFromJobStatus(job.status),
    error: null,
    job,
    digitalHumanId: job.digital_human_id,
  };
}

/** Applies a fresh job snapshot from polling. */
export function jobUpdated(
  state: AvatarBuildState,
  job: BuildJobData,
): AvatarBuildState {
  return {
    ...state,
    stage: stageFromJobStatus(job.status),
    error: state.error,
    job,
    digitalHumanId: job.digital_human_id,
  };
}

/** Marks the build as succeeded, keeping the resulting job for review. */
export function buildSucceeded(
  state: AvatarBuildState,
  job: BuildJobData,
): AvatarBuildState {
  return {
    ...state,
    stage: "ready",
    error: null,
    job,
    digitalHumanId: job.digital_human_id,
  };
}

export function buildFailed(
  state: AvatarBuildState,
  error: string,
): AvatarBuildState {
  if (state.stage === "cancelled" || state.stage === "ready") {
    return state;
  }
  return { ...state, stage: "failed", error };
}

/** Cancellation was requested; the server is now driving toward `cancelled`. */
export function cancelRequested(
  state: AvatarBuildState,
): AvatarBuildState {
  if (state.stage !== "building" && state.stage !== "submitting") {
    return state;
  }
  return { ...state, stage: "cancelling", error: null };
}

/** The server confirmed the job reached `cancelled`. */
export function jobCancelled(
  state: AvatarBuildState,
  job: BuildJobData,
): AvatarBuildState {
  return {
    ...state,
    stage: "cancelled",
    error: null,
    job,
    digitalHumanId: job.digital_human_id,
  };
}

export function retryBuild(state: AvatarBuildState): AvatarBuildState {
  if (state.stage !== "failed" && state.stage !== "cancelled") {
    return state;
  }
  return startBuild(state);
}