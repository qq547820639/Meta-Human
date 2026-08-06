import { describe, expect, it } from "vitest";

import {
  LOCAL_BASE_URL,
  REMOTE_BASE_URL,
  resolvePreset,
} from "./presets";

describe("presets", () => {
  it("resolves fully_local with only local providers enabled", () => {
    const plan = resolvePreset("fully_local");
    expect(plan.providers).toEqual({
      local: true,
      remote: false,
      advanced: false,
    });
    expect(plan.baseUrls.local).toBe(LOCAL_BASE_URL);
    expect(plan.baseUrls.remote).toBeNull();
    expect(plan.description.trim().length).toBeGreaterThan(0);
  });

  it("never auto-enables advanced providers for fully_local", () => {
    const plan = resolvePreset("fully_local");
    expect(plan.providers.advanced).toBe(false);
  });

  it("resolves cloud_enhanced with remote-only providers", () => {
    const plan = resolvePreset("cloud_enhanced");
    expect(plan.providers).toEqual({
      local: false,
      remote: true,
      advanced: true,
    });
    expect(plan.baseUrls.local).toBeNull();
    expect(plan.baseUrls.remote).toBe(REMOTE_BASE_URL);
    expect(plan.description.trim().length).toBeGreaterThan(0);
  });

  it("resolves hybrid with local + remote providers", () => {
    const plan = resolvePreset("hybrid");
    expect(plan.providers).toEqual({
      local: true,
      remote: true,
      advanced: true,
    });
    expect(plan.baseUrls.local).toBe(LOCAL_BASE_URL);
    expect(plan.baseUrls.remote).toBe(REMOTE_BASE_URL);
    expect(plan.description.trim().length).toBeGreaterThan(0);
  });

  it("gives every preset a non-empty description and model ids", () => {
    for (const preset of ["fully_local", "cloud_enhanced", "hybrid"] as const) {
      const plan = resolvePreset(preset);
      expect(plan.description.trim().length).toBeGreaterThan(0);
      expect(plan.modelIds.chat.trim().length).toBeGreaterThan(0);
      expect(plan.modelIds.embedding.trim().length).toBeGreaterThan(0);
      expect(plan.modelIds.stt.trim().length).toBeGreaterThan(0);
    }
  });

  it("is deterministic regardless of hardware input", () => {
    const rich = resolvePreset("hybrid", {
      memoryGb: 32,
      hasMic: true,
    });
    const poor = resolvePreset("hybrid", {
      memoryGb: 4,
      freeDiskGb: 2,
    });
    expect(rich).toEqual(poor);
  });
});