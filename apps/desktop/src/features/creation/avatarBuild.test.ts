import { describe, expect, it } from "vitest";

import type { BuildJobData } from "../../api/contracts";
import {
  AvatarBuildState,
  buildFailed,
  buildSucceeded,
  cancelRequested,
  initialAvatarBuildState,
  jobAccepted,
  jobCancelled,
  jobUpdated,
  retryBuild,
  stageFromJobStatus,
  startBuild,
  validationSucceeded,
} from "./avatarBuild";

function runningJob(overrides: Partial<BuildJobData> = {}): BuildJobData {
  return {
    id: "job-1",
    status: "running",
    current_stage: "enroll_voice",
    stage_progress: null,
    succeeded_stages: ["validate_inputs"],
    retry_count: 0,
    error_code: null,
    error_detail: null,
    cancelled: false,
    digital_human_id: "human-1",
    created_at: "2026-08-04T00:00:00Z",
    updated_at: "2026-08-04T00:00:00Z",
    completed_at: null,
    ...overrides,
  };
}

describe("avatarBuild state machine", () => {
  it("maps backend job statuses to the coarse UI stage", () => {
    expect(stageFromJobStatus("pending")).toBe("building");
    expect(stageFromJobStatus("running")).toBe("building");
    expect(stageFromJobStatus("succeeded")).toBe("ready");
    expect(stageFromJobStatus("failed")).toBe("failed");
    expect(stageFromJobStatus("cancelling")).toBe("cancelling");
    expect(stageFromJobStatus("cancelled")).toBe("cancelled");
    expect(stageFromJobStatus("cleanup_pending")).toBe("cleanup");
    expect(stageFromJobStatus("cleanup_failed")).toBe("cleanup");
  });

  it("moves through submit -> building -> ready from job snapshots", () => {
    let state = startBuild(initialAvatarBuildState);
    expect(state.stage).toBe("validating");

    state = validationSucceeded(state);
    expect(state.stage).toBe("submitting");

    state = jobAccepted(state, runningJob());
    expect(state.stage).toBe("building");
    expect(state.job?.id).toBe("job-1");
    expect(state.digitalHumanId).toBe("human-1");

    state = buildSucceeded(state, runningJob({ status: "succeeded" }));
    expect(state.stage).toBe("ready");
  });

  it("keeps media recoverable after a failure", () => {
    const failed = buildFailed(
      { ...initialAvatarBuildState, stage: "building" },
      "构建服务暂时不可用。",
    );
    expect(failed.stage).toBe("failed");
    expect(failed.error).toBe("构建服务暂时不可用。");
    expect(retryBuild(failed).stage).toBe("validating");
  });

  it("requests cancellation only while work is in progress", () => {
    expect(cancelRequested(initialAvatarBuildState).stage).toBe("idle");
    expect(
      cancelRequested({ ...initialAvatarBuildState, stage: "building" }).stage,
    ).toBe("cancelling");
  });

  it("confirms cancellation from the authoritative job snapshot", () => {
    const cancelled = jobCancelled(
      { ...initialAvatarBuildState, stage: "cancelling" },
      runningJob({ status: "cancelled", cancelled: true }),
    );
    expect(cancelled.stage).toBe("cancelled");
    expect(cancelled.job?.cancelled).toBe(true);
  });

  it("ignores invalid transitions", () => {
    // `ready` is terminal: further cancel/failure/retry transitions are ignored.
    const ready: AvatarBuildState = {
      ...initialAvatarBuildState,
      stage: "ready",
    };
    expect(cancelRequested(ready).stage).toBe("ready");
    expect(buildFailed(ready, "x").stage).toBe("ready");
    expect(retryBuild(ready).stage).toBe("ready");
    // Retry only applies to failed/cancelled, not to the idle state.
    expect(retryBuild(initialAvatarBuildState).stage).toBe("idle");
  });
});