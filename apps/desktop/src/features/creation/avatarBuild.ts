export type BuildStage =
  | "idle"
  | "validating"
  | "building"
  | "ready"
  | "failed"
  | "cancelled";

export interface AvatarBuildState {
  readonly stage: BuildStage;
  readonly error: string | null;
}

export const initialAvatarBuildState: AvatarBuildState = {
  stage: "idle",
  error: null,
};

export function startBuild(
  state: AvatarBuildState,
): AvatarBuildState {
  return { stage: "validating", error: null };
}

export function validationSucceeded(
  state: AvatarBuildState,
): AvatarBuildState {
  if (state.stage !== "validating") {
    return state;
  }
  return { stage: "building", error: null };
}

export function buildSucceeded(
  state: AvatarBuildState,
): AvatarBuildState {
  if (state.stage !== "building") {
    return state;
  }
  return { stage: "ready", error: null };
}

export function buildFailed(
  state: AvatarBuildState,
  error: string,
): AvatarBuildState {
  if (state.stage !== "building" && state.stage !== "validating") {
    return state;
  }
  return { stage: "failed", error };
}

export function cancelBuild(
  state: AvatarBuildState,
): AvatarBuildState {
  if (state.stage !== "validating" && state.stage !== "building") {
    return state;
  }
  return { stage: "cancelled", error: null };
}

export function retryBuild(
  state: AvatarBuildState,
): AvatarBuildState {
  if (state.stage !== "failed" && state.stage !== "cancelled") {
    return state;
  }
  return startBuild(state);
}
