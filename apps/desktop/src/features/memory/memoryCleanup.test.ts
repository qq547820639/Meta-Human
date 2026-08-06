import { describe, expect, it } from "vitest";

import { memoryBucketKey, planMemoryCleanup } from "./memoryCleanup";

describe("memoryBucketKey", () => {
  it("builds a stable bucket key for an avatar", () => {
    expect(memoryBucketKey("avatar-1")).toBe("avatar:memories:avatar-1");
  });
});

describe("planMemoryCleanup", () => {
  it("local-only cleanup is verifiable and does not request remote", () => {
    const plan = planMemoryCleanup({ avatarId: "a1", remoteSyncEnabled: false });
    expect(plan.localMemoriesToDelete).toEqual(["avatar:memories:a1"]);
    expect(plan.remoteRequested).toBe(false);
    expect(plan.verifiable).toBe(true);
  });

  it("remote present but unconfirmed is not verifiable yet", () => {
    const plan = planMemoryCleanup({ avatarId: "a1", remoteSyncEnabled: true, remoteConfirmed: false });
    expect(plan.remoteRequested).toBe(true);
    expect(plan.verifiable).toBe(false);
  });

  it("remote present and confirmed is verifiable", () => {
    const plan = planMemoryCleanup({ avatarId: "a1", remoteSyncEnabled: true, remoteConfirmed: true });
    expect(plan.remoteRequested).toBe(true);
    expect(plan.verifiable).toBe(true);
  });
});