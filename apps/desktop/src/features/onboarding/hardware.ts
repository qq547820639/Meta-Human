/**
 * First-use hardware capability detection and model / run-mode recommendation.
 *
 * Pure, jsdom-safe logic: it never touches browser or Tauri APIs. The caller
 * (a probe or the settings layer) is responsible for supplying the raw
 * `HardwareInput`; this module normalizes possibly-missing fields to
 * "unknown" and derives a recommended run mode and default model ids.
 */

/** How the app should be run for a given machine. */
export type RunMode = "fully_local" | "cloud_enhanced" | "hybrid";

export interface HardwareInput {
  readonly cpuArch?: string | null;
  readonly memoryGb?: number | null;
  readonly freeDiskGb?: number | null;
  readonly hasMic?: boolean | null;
  readonly hasCamera?: boolean | null;
}

export type CpuArchValue = string | "unknown";
export type MemoryValue = number | "unknown";
export type DiskValue = number | "unknown";
export type BoolValue = boolean | "unknown";

export interface HardwareInfo {
  readonly cpuArch: CpuArchValue;
  readonly memoryGb: MemoryValue;
  readonly freeDiskGb: DiskValue;
  readonly hasMic: BoolValue;
  readonly hasCamera: BoolValue;
}

export interface ModelDefaults {
  readonly chat: string;
  readonly embedding: string;
  readonly stt: string;
}

/** Default model ids per run mode. Shared by recommendation and presets. */
export const DEFAULT_MODELS: Record<RunMode, ModelDefaults> = {
  fully_local: {
    chat: "llama3",
    embedding: "nomic-embed-text",
    stt: "whisper-small",
  },
  hybrid: {
    chat: "llama3",
    embedding: "nomic-embed-text",
    stt: "sensevoice-small",
  },
  cloud_enhanced: {
    chat: "qwen-plus",
    embedding: "text-embedding-v3",
    stt: "sensevoice-small",
  },
};

/** Normalize a numeric field: finite non-negative numbers stay, else "unknown". */
function normalizeNumber(value: number | null | undefined): MemoryValue {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }
  return "unknown";
}

function normalizeBool(value: boolean | null | undefined): BoolValue {
  return typeof value === "boolean" ? value : "unknown";
}

function normalizeArch(value: string | null | undefined): CpuArchValue {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return "unknown";
}

/** Normalize and validate raw hardware input into a well-typed snapshot. */
export function detectHardwareInfo(input: HardwareInput): HardwareInfo {
  return {
    cpuArch: normalizeArch(input.cpuArch),
    memoryGb: normalizeNumber(input.memoryGb),
    freeDiskGb: normalizeNumber(input.freeDiskGb),
    hasMic: normalizeBool(input.hasMic),
    hasCamera: normalizeBool(input.hasCamera),
  };
}

/**
 * Derive a recommended run mode from known hardware.
 *
 * - Low memory (< 8 GB) or low free disk (< 10 GB) -> cloud_enhanced, because
 *   heavy local models cannot be served comfortably.
 * - Ample memory (>= 16 GB) with a microphone -> hybrid, so local chat +
 *   embedding run while STT / other heavy paths can lean on the cloud.
 * - Otherwise -> fully_local.
 */
export function recommendRunMode(hw: HardwareInfo): RunMode {
  if (typeof hw.memoryGb === "number" && hw.memoryGb < 8) {
    return "cloud_enhanced";
  }
  if (typeof hw.freeDiskGb === "number" && hw.freeDiskGb < 10) {
    return "cloud_enhanced";
  }
  if (typeof hw.memoryGb === "number" && hw.memoryGb >= 16 && hw.hasMic === true) {
    return "hybrid";
  }
  return "fully_local";
}

/** Default model ids for the recommended run mode. */
export function recommendModel(hw: HardwareInfo): ModelDefaults {
  return DEFAULT_MODELS[recommendRunMode(hw)];
}