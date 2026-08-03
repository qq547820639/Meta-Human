import { describe, expect, it } from "vitest";

import {
  AvatarBuildState,
  buildFailed,
  buildSucceeded,
  cancelBuild,
  initialAvatarBuildState,
  retryBuild,
  startBuild,
  validationSucceeded,
} from "./avatarBuild";

describe("avatarBuild state machine", () => {
  it("moves through honest stages without fake percentages", () => {
    let state = startBuild(initialAvatarBuildState);
    expect(state.stage).toBe("validating");

    state = validationSucceeded(state);
    expect(state.stage).toBe("building");

    state = buildSucceeded(state);
    expect(state.stage).toBe("ready");
  });

  it("keeps media recoverable after a failure", () => {
    const failed = buildFailed(
      { stage: "building", error: null },
      "构建服务暂时不可用。",
    );

    expect(failed).toEqual({
      stage: "failed",
      error: "构建服务暂时不可用。",
    });
    expect(retryBuild(failed).stage).toBe("validating");
  });

  it("allows cancellation only while work is in progress", () => {
    expect(cancelBuild(initialAvatarBuildState).stage).toBe("idle");
    expect(cancelBuild({ stage: "building", error: null }).stage).toBe(
      "cancelled",
    );
  });

  it("ignores invalid transitions", () => {
    const ready: AvatarBuildState = { stage: "ready", error: null };

    expect(validationSucceeded(ready)).toBe(ready);
    expect(buildSucceeded(initialAvatarBuildState)).toBe(
      initialAvatarBuildState,
    );
    expect(retryBuild(ready)).toBe(ready);
  });
});
