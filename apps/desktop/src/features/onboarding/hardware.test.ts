import { describe, expect, it } from "vitest";

import {
  DEFAULT_MODELS,
  detectHardwareInfo,
  recommendModel,
  recommendRunMode,
} from "./hardware";

describe("hardware", () => {
  it("normalizes valid fields and marks missing ones as unknown", () => {
    const hw = detectHardwareInfo({
      cpuArch: " arm64 ",
      memoryGb: 32,
      freeDiskGb: 200,
      hasMic: true,
      hasCamera: false,
    });
    expect(hw.cpuArch).toBe("arm64");
    expect(hw.memoryGb).toBe(32);
    expect(hw.freeDiskGb).toBe(200);
    expect(hw.hasMic).toBe(true);
    expect(hw.hasCamera).toBe(false);
  });

  it("marks every missing / invalid field as unknown", () => {
    const hw = detectHardwareInfo({
      cpuArch: "   ",
      memoryGb: Number.NaN,
      freeDiskGb: -5,
      hasMic: null,
      hasCamera: undefined,
    });
    expect(hw.cpuArch).toBe("unknown");
    expect(hw.memoryGb).toBe("unknown");
    expect(hw.freeDiskGb).toBe("unknown");
    expect(hw.hasMic).toBe("unknown");
    expect(hw.hasCamera).toBe("unknown");
  });

  it("treats an empty input as all unknown", () => {
    const hw = detectHardwareInfo({});
    expect(hw.memoryGb).toBe("unknown");
    expect(hw.freeDiskGb).toBe("unknown");
    expect(hw.hasMic).toBe("unknown");
    expect(hw.hasCamera).toBe("unknown");
  });

  it("recommends cloud_enhanced for low memory", () => {
    const hw = detectHardwareInfo({ memoryGb: 4, freeDiskGb: 100 });
    expect(recommendRunMode(hw)).toBe("cloud_enhanced");
  });

  it("recommends cloud_enhanced for low free disk", () => {
    const hw = detectHardwareInfo({ memoryGb: 32, freeDiskGb: 5 });
    expect(recommendRunMode(hw)).toBe("cloud_enhanced");
  });

  it("recommends hybrid for ample memory with a microphone", () => {
    const hw = detectHardwareInfo({ memoryGb: 32, freeDiskGb: 100, hasMic: true });
    expect(recommendRunMode(hw)).toBe("hybrid");
  });

  it("recommends fully_local for ample memory without a microphone", () => {
    const hw = detectHardwareInfo({ memoryGb: 32, freeDiskGb: 100, hasMic: false });
    expect(recommendRunMode(hw)).toBe("fully_local");
  });

  it("recommends fully_local when nothing is known", () => {
    expect(recommendRunMode(detectHardwareInfo({}))).toBe("fully_local");
  });

  it("returns default model ids for each run mode branch", () => {
    const lowMem = recommendModel(detectHardwareInfo({ memoryGb: 4 }));
    expect(lowMem).toBe(DEFAULT_MODELS.cloud_enhanced);
    expect(lowMem.chat).toBe("qwen-plus");

    const hybrid = recommendModel(
      detectHardwareInfo({ memoryGb: 32, hasMic: true }),
    );
    expect(hybrid.stt).toBe("sensevoice-small");

    const local = recommendModel(
      detectHardwareInfo({ memoryGb: 32, hasMic: false }),
    );
    expect(local).toBe(DEFAULT_MODELS.fully_local);
    expect(local.chat).toBe("llama3");
  });
});