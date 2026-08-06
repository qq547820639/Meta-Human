/**
 * Guided first-launch flow definition.
 *
 * Pure, jsdom-safe. Defines the ordered 5-step onboarding flow and helpers to
 * navigate it (next step, resume, remaining-time estimate). Each step carries
 * exactly one primary decision so the UI never asks the user to make more than
 * one call-to-action at a time.
 */

export type OnboardingStepId =
  | "prepare-environment"
  | "create-avatar"
  | "create-voice"
  | "first-answer"
  | "save-memory";

export interface OnboardingStep {
  readonly id: OnboardingStepId;
  readonly index: number;
  readonly title: string;
  readonly description: string;
  /** Exactly one primary decision per step. */
  readonly primaryDecision: string;
}

export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  {
    id: "prepare-environment",
    index: 0,
    title: "准备运行环境",
    description: "检测本机硬件并选择推荐的运行方式。",
    primaryDecision: "选择运行方式",
  },
  {
    id: "create-avatar",
    index: 1,
    title: "创建形象",
    description: "拍摄或选择一张照片作为你的数字人形象。",
    primaryDecision: "确认形象",
  },
  {
    id: "create-voice",
    index: 2,
    title: "创建声音",
    description: "录制或选择一段声音作为你的数字人音色。",
    primaryDecision: "确认音色",
  },
  {
    id: "first-answer",
    index: 3,
    title: "首次回答",
    description: "向数字人提出第一个问题，验证它能听见并回答。",
    primaryDecision: "提问并等待回答",
  },
  {
    id: "save-memory",
    index: 4,
    title: "保存记忆",
    description: "保存本次对话，让数字人在后续记住你的偏好。",
    primaryDecision: "保存对话",
  },
] as const;

/** Total number of steps in the first-launch flow. */
export function totalSteps(): number {
  return ONBOARDING_STEPS.length;
}

/** Returns the step at the given index, or null when out of range. */
export function stepForIndex(index: number): OnboardingStep | null {
  return ONBOARDING_STEPS[index] ?? null;
}

/** Returns the id of the step that follows `current`, or null when last. */
export function nextStep(
  current: OnboardingStepId,
): OnboardingStepId | null {
  const currentIndex = ONBOARDING_STEPS.findIndex((step) => step.id === current);
  if (currentIndex < 0) return null;
  const nextStepIndex = currentIndex + 1;
  return nextStepIndex < ONBOARDING_STEPS.length
    ? ONBOARDING_STEPS[nextStepIndex].id
    : null;
}

/**
 * Estimate the remaining time (in seconds) to finish the flow from a given
 * step index. `perStepMs` is the assumed average duration of one step. The
 * result is monotonic: later steps never report more remaining time.
 */
export function estimateRemaining(
  stepIndex: number,
  perStepMs: number,
): number {
  const clampedIndex = Math.max(0, stepIndex);
  const remainingSteps = Math.max(0, totalSteps() - clampedIndex);
  const remainingMs = Math.max(0, remainingSteps * Math.max(0, perStepMs));
  return Math.round(remainingMs / 1000);
}

/**
 * Resume the flow after interruption. Given the index of the last completed
 * step, returns the next incomplete step index, or null when the whole flow is
 * complete. Passing -1 (nothing completed) resumes from step 0.
 */
export function resumeStep(lastCompletedStep: number): number | null {
  const nextIndex = lastCompletedStep + 1;
  if (nextIndex >= totalSteps()) return null;
  return Math.max(0, nextIndex);
}