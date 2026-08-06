/**
 * First-use provider presets resolver.
 *
 * Turns a run-mode choice into a concrete provider plan: which providers are
 * enabled, the base urls to configure, the model ids to use and a
 * human-readable Chinese description. Advanced providers (e.g. Feishu
 * knowledge) are never auto-enabled for the fully_local preset — they are
 * opt-in so a zero-configuration first run stays focused.
 */

import type { HardwareInput, ModelDefaults, RunMode } from "./hardware";
import { detectHardwareInfo, DEFAULT_MODELS } from "./hardware";

export type OnboardingPreset = RunMode;

export interface ProviderSwitches {
  /** Local OpenAI-compatible service (Ollama / LM Studio). */
  readonly local: boolean;
  /** Remote / cloud TTS + avatar service. */
  readonly remote: boolean;
  /** Advanced providers (Feishu knowledge base, etc.). */
  readonly advanced: boolean;
}

export interface ProviderPlan {
  readonly mode: OnboardingPreset;
  readonly providers: ProviderSwitches;
  readonly baseUrls: {
    readonly local: string | null;
    readonly remote: string | null;
  };
  readonly modelIds: ModelDefaults;
  /** Human-readable Chinese description of the preset. */
  readonly description: string;
}

export const LOCAL_BASE_URL = "http://127.0.0.1:11434";
export const REMOTE_BASE_URL = "https://api.example-remote.ai/v1";

const PRESET_DESCRIPTIONS: Record<OnboardingPreset, string> = {
  fully_local:
    "所有能力都在本机运行，你的照片和声音不会离开这台设备，适合注重隐私且硬件配置足够的场景。",
  cloud_enhanced:
    "把语音识别等重计算交给云端，本地不再承担大模型负载，适合内存或磁盘较小的设备。",
  hybrid:
    "对话与知识检索在本地进行，语音识别等能力由云端补充，兼顾隐私、速度与体验。",
};

/**
 * Advanced providers are only available when at least one remote-capable
 * preset is chosen; fully_local never auto-enables them.
 */
function providersFor(mode: OnboardingPreset): ProviderSwitches {
  switch (mode) {
    case "cloud_enhanced":
      return { local: false, remote: true, advanced: true };
    case "hybrid":
      return { local: true, remote: true, advanced: true };
    case "fully_local":
    default:
      return { local: true, remote: false, advanced: false };
  }
}

function baseUrlsFor(mode: OnboardingPreset): ProviderPlan["baseUrls"] {
  switch (mode) {
    case "cloud_enhanced":
      return { local: null, remote: REMOTE_BASE_URL };
    case "hybrid":
      return { local: LOCAL_BASE_URL, remote: REMOTE_BASE_URL };
    case "fully_local":
    default:
      return { local: LOCAL_BASE_URL, remote: null };
  }
}

/**
 * Resolve a preset into a provider plan. `hw` (optional) is only used to
 * validate/normalize the hardware snapshot; model ids come from the preset's
 * defaults, not from the machine, so the plan is deterministic per preset.
 */
export function resolvePreset(
  preset: OnboardingPreset,
  hw?: HardwareInput,
): ProviderPlan {
  void hw;
  return {
    mode: preset,
    providers: providersFor(preset),
    baseUrls: baseUrlsFor(preset),
    modelIds: DEFAULT_MODELS[preset],
    description: PRESET_DESCRIPTIONS[preset],
  };
}