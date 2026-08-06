/**
 * First-success criterion.
 *
 * Pure, jsdom-safe. Decides whether the first launch "succeeded". Per the
 * product rule, first launch only counts as a success when the user received a
 * meaningful AND audible answer with no blocking error. Each failure mode maps
 * to a Chinese reason string so the UI can explain exactly what went wrong.
 */

export interface FirstSuccessInput {
  /** Did the assistant produce a reply that was actually spoken aloud? */
  readonly audibleReply: boolean;
  /** Did any blocking error occur during the first session? */
  readonly hadError: boolean;
  /** Did the reply carry real, substantive content (not a placeholder)? */
  readonly meaningful: boolean;
}

export interface FirstSuccessResult {
  readonly passed: boolean;
  readonly reason: string;
}

/**
 * Evaluate the first-success criterion. Returns `passed: true` only when the
 * answer was audible, meaningful and error-free.
 */
export function evaluateFirstSuccess(
  input: FirstSuccessInput,
): FirstSuccessResult {
  if (input.hadError) {
    return {
      passed: false,
      reason: "首次对话遇到了错误，数字人未能正常回答，请修复后重试。",
    };
  }
  if (!input.audibleReply) {
    return {
      passed: false,
      reason: "数字人没有发出声音，请检查音色与语音播放是否正常。",
    };
  }
  if (!input.meaningful) {
    return {
      passed: false,
      reason: "数字人的回答没有实质内容，未能形成有效对话，请重新提问。",
    };
  }
  return {
    passed: true,
    reason: "首次对话成功：你收到了数字人清晰且有意义的语音回答。",
  };
}