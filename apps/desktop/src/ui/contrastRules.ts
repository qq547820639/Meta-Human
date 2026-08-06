/**
 * Contrast, error-not-color-only, reduced-motion and dynamic-font rules.
 *
 * Pure, deterministic WCAG helpers. They parse colours (hex/rgb) and apply
 * accessibility thresholds; no browser APIs are touched.
 */

interface RGB {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** Parses `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb(...)` or `rgba(...)`. */
function parseColor(input: string): RGB | null {
  const s = input.trim().toLowerCase();
  let match = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s);
  if (match) {
    let hex = match[1];
    if (hex.length === 3) {
      hex = hex
        .split("")
        .map((c) => c + c)
        .join("");
    }
    if (hex.length === 8) {
      hex = hex.slice(0, 6); // ignore alpha channel
    }
    const n = parseInt(hex, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  match = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/.exec(s);
  if (match) {
    return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]) };
  }
  return null;
}

function luminance({ r, g, b }: RGB): number {
  const channel = (value: number): number => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * WCAG contrast ratio between a foreground and background colour. Returns 0
 * when either colour cannot be parsed.
 */
export function contrastRatio(fg: string, bg: string): number {
  const foreground = parseColor(fg);
  const background = parseColor(bg);
  if (!foreground || !background) {
    return 0;
  }
  const l1 = luminance(foreground);
  const l2 = luminance(background);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Whether a ratio passes WCAG AA. Large text/ui components need only 3:1;
 * normal text needs 4.5:1.
 */
export function passesAA(ratio: number, isLarge: boolean): boolean {
  return isLarge ? ratio >= 3 : ratio >= 4.5;
}

export interface ErrorIndicatorInput {
  /** Whether the error is communicated by colour alone. */
  readonly colorOnly: boolean;
  /** Whether an icon also signals the error. */
  readonly hasIcon: boolean;
  /** Whether text also signals the error. */
  readonly hasText: boolean;
}

/**
 * Whether an error currently relies on colour alone and therefore fails the
 * "not by colour alone" WCAG success criterion. A non-colour indicator (icon
 * or text) removes the problem.
 */
export function errorRequiresNonColorIndicator(
  input: ErrorIndicatorInput,
): boolean {
  return input.colorOnly && !input.hasIcon && !input.hasText;
}

/**
 * Whether a `prefers-reduced-motion` media-query value means the user wants
 * motion reduced. Accepts the `mediaQueryList.media`-style tokens ("reduce" /
 * "no-preference") or an empty string when unavailable.
 */
export function shouldReduceMotion(pref: string): boolean {
  return pref.toLowerCase() === "reduce";
}

/**
 * Scales a base pixel size by a dynamic-font factor (e.g. 1.25 for a 125%
 * user font-size). Used to keep UI dimensions proportional to the user's
 * preferred font size.
 */
export function scalesWithDynamicFont(basePx: number, factor: number): number {
  return basePx * factor;
}