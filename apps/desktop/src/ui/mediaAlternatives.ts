/**
 * Media alternatives: subtitles, audio-absence text, and live-status labels.
 *
 * Pure helpers that decide when a subtitle is required, produce a text
 * alternative for audio, and map streaming phases to screen-reader-friendly
 * declarative labels. No DOM/audio APIs are touched.
 */

export interface SubtitleRequirementInput {
  /** Whether the media has an audio track. */
  readonly hasAudio: boolean;
  /** Whether the audio carries speech (as opposed to instrumental sound). */
  readonly hasSpeech: boolean;
}

/**
 * Subtitles are required when there is audio carrying speech. Audio without
 * speech (or no audio at all) has no spoken content to caption.
 */
export function requiresSubtitle(input: SubtitleRequirementInput): boolean {
  return input.hasAudio && input.hasSpeech;
}

export interface TextAlternativeInput {
  /** Whether audio content is available. */
  readonly audioAvailable: boolean;
  /** Whether a caption/subtitle accompanies the audio. */
  readonly hasCaption: boolean;
}

/**
 * A plain-language description of the audio track's accessibility status,
 * used as a text alternative when the audio itself is unavailable or silent.
 */
export function textAlternativeFor(input: TextAlternativeInput): string {
  if (!input.audioAvailable) {
    return "当前没有音频内容。";
  }
  if (input.hasCaption) {
    return "音频已提供同步字幕。";
  }
  return "音频播放中，但未提供字幕。";
}

export type LiveRegionMode = "status" | "log" | "alert";

/** Declarative, screen-reader-friendly labels for the streaming phases. */
const LIVE_STATUS_LABELS: Record<string, string> = {
  idle: "自然对话已关闭",
  listening: "正在聆听你的声音",
  transcribing: "正在转写你的话",
  thinking: "正在思考回复",
  speaking: "数字人正在说话",
  interrupted: "对话已打断",
  reconnecting: "网络不稳定，正在尝试重连",
  error: "对话出现错误",
};

/**
 * Maps a streaming state to a declarative label. The `role` of the live
 * region dials up the urgency for `alert` regions (used alongside
 * `aria-live="assertive"`); `status`/`log` regions stay polite.
 */
export function liveStatusLabel(
  state: string,
  opts: { readonly role: LiveRegionMode },
): string {
  const label = LIVE_STATUS_LABELS[state] ?? `状态：${state}`;
  return opts.role === "alert" ? `注意：${label}` : label;
}