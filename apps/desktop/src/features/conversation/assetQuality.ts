/**
 * Avatar creation asset-quality checks (Task 7).
 *
 * Before creating a digital human we validate the uploaded photo and audio
 * sample so the user fixes obvious problems up-front instead of after the
 * avatar looks/sounds wrong. Every check returns a pass/fail plus a specific,
 * human-readable suggestion for how to fix a failing asset.
 */

export interface PhotoAsset {
  readonly width: number;
  readonly height: number;
  /** Sharpness / focus score in [0, 1] (1 = perfectly sharp). */
  readonly focus: number;
}

export interface AudioAsset {
  readonly durationSec: number;
  readonly sampleRate: number;
  /** True when the sample contains a (long) silence segment. */
  readonly hasSilence: boolean;
}

export interface AvatarAssetInput {
  readonly photo?: PhotoAsset;
  readonly audio?: AudioAsset;
}

export interface AssetCheck {
  readonly id: string;
  readonly pass: boolean;
  /** Specific, actionable fix suggestion when `pass` is false. */
  readonly suggestion: string;
}

export interface AssetAssessment {
  readonly checks: readonly AssetCheck[];
  /** True when every performed check passes. */
  readonly allPass: boolean;
}

/** Minimum photo dimension (either side) for a usable avatar portrait. */
export const MIN_PHOTO_DIMENSION = 512;
/** Minimum accepted photo focus / sharpness score. */
export const MIN_PHOTO_FOCUS = 0.6;
/** Minimum voice-sample duration for reliable voice cloning. */
export const MIN_AUDIO_DURATION_SEC = 3;
/** Minimum audio sample rate for voice cloning. */
export const MIN_AUDIO_SAMPLE_RATE = 16_000;

/**
 * Assesses the provided avatar assets. Checks are only performed for assets
 * that were supplied; an empty input yields no checks and passes trivially.
 */
export function assessAvatarAsset(input: AvatarAssetInput): AssetAssessment {
  const checks: AssetCheck[] = [];

  if (input.photo) {
    const { width, height, focus } = input.photo;
    const resolutionOk =
      width >= MIN_PHOTO_DIMENSION && height >= MIN_PHOTO_DIMENSION;
    checks.push({
      id: "photo_resolution",
      pass: resolutionOk,
      suggestion: resolutionOk
        ? "照片分辨率合格。"
        : "照片分辨率过低，请使用不低于 512x512 的正面清晰照片。",
    });
    const focusOk = focus >= MIN_PHOTO_FOCUS;
    checks.push({
      id: "photo_focus",
      pass: focusOk,
      suggestion: focusOk
        ? "照片清晰度合格。"
        : "照片存在模糊，请更换为对焦清晰的正面照片。",
    });
  }

  if (input.audio) {
    const { durationSec, sampleRate, hasSilence } = input.audio;
    const durationOk = durationSec >= MIN_AUDIO_DURATION_SEC;
    checks.push({
      id: "audio_duration",
      pass: durationOk,
      suggestion: durationOk
        ? "音频时长合格。"
        : "音频时长过短，请提供不少于 3 秒的清晰语音样本。",
    });
    const sampleRateOk = sampleRate >= MIN_AUDIO_SAMPLE_RATE;
    checks.push({
      id: "audio_sample_rate",
      pass: sampleRateOk,
      suggestion: sampleRateOk
        ? "音频采样率合格。"
        : "音频采样率过低，请使用不低于 16000Hz 的语音样本。",
    });
    const silenceOk = !hasSilence;
    checks.push({
      id: "audio_silence",
      pass: silenceOk,
      suggestion: silenceOk
        ? "音频无静音段。"
        : "音频包含长时间静音，请提供无静音段的连续语音样本。",
    });
  }

  return {
    checks,
    allPass: checks.every((c) => c.pass),
  };
}