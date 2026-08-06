/**
 * Design tokens: spacing, typography, radius, shadow, motion and colour.
 *
 * The colour palettes mirror the `--studio-*` custom properties in
 * `ui/themes.css` (light default, dark for the OS dark scheme). All tokens are
 * exposed through a typed accessor that flattens the nested structure into
 * dotted paths (e.g. `token("spacing.md")`, `token("colors.dark.primary")`).
 */

export type ThemeScheme = "light" | "dark";
export type ThemePreference = "light" | "dark" | "system";

export interface SemanticPalette {
  readonly background: string;
  readonly surface: string;
  readonly text: string;
  readonly muted: string;
  readonly line: string;
  readonly primary: string;
  readonly primaryDeep: string;
  readonly error: string;
  readonly success: string;
  readonly warning: string;
}

export const designTokens = {
  spacing: {
    xs: "0.25rem",
    sm: "0.5rem",
    md: "0.75rem",
    lg: "1rem",
    xl: "1.5rem",
  },
  typography: {
    fontSizeSm: "0.875rem",
    fontSizeBase: "1rem",
    fontSizeLg: "1.125rem",
    fontSizeXl: "1.25rem",
    fontWeightNormal: "400",
    fontWeightMedium: "540",
    fontWeightSemibold: "680",
    fontWeightBold: "700",
    lineHeight: "1.5",
  },
  radius: {
    sm: "0.375rem",
    md: "0.5rem",
    lg: "0.75rem",
    xl: "1rem",
  },
  shadow: {
    sm: "0 1px 2px rgba(0, 0, 0, 0.08)",
    md: "0 4px 12px rgba(0, 0, 0, 0.12)",
    lg: "0 8px 24px rgba(0, 0, 0, 0.16)",
    xl: "0 16px 40px rgba(0, 0, 0, 0.2)",
  },
  motion: {
    fast: "120ms",
    normal: "180ms",
    slow: "260ms",
  },
  colors: {
    light: {
      background: "#f6f5ef",
      surface: "#ecebe2",
      text: "#1a1814",
      muted: "#3a3f4b",
      line: "#d6d3c8",
      primary: "#b4533a",
      primaryDeep: "#a03f2c",
      error: "#c0392b",
      success: "#2e7d32",
      warning: "#b8860b",
    } satisfies SemanticPalette,
    dark: {
      background: "#26241f",
      surface: "#2f2d27",
      text: "#ecebe2",
      muted: "#b3b3b3",
      line: "#4a4740",
      primary: "#e08d6f",
      primaryDeep: "#d97a5a",
      error: "#ef5350",
      success: "#66bb6a",
      warning: "#ffca28",
    } satisfies SemanticPalette,
  },
} as const;

/** Flattens the nested token object into dotted-path leaf values. */
function flatten(
  obj: unknown,
  prefix = "",
  out: Record<string, string> = {},
): Record<string, string> {
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") {
      out[path] = value;
    } else {
      flatten(value, path, out);
    }
  }
  return out;
}

const tokenMap = flatten(designTokens);

export type TokenPath = keyof typeof tokenMap;

/** Typed accessor returning the CSS value for a dotted token path. */
export function token<T extends TokenPath>(name: T): string {
  return tokenMap[name];
}

/** Every available token path, useful for tooling and exhaustive checks. */
export function tokenNames(): readonly TokenPath[] {
  return Object.keys(tokenMap) as readonly TokenPath[];
}

/**
 * Resolves a theme preference against the OS scheme. `light`/`dark` always
 * win; `system` defers to the detected OS scheme.
 */
export function resolveTheme(
  pref: ThemePreference,
  systemPref: ThemeScheme,
): ThemeScheme {
  return pref === "system" ? systemPref : pref;
}

/** Returns the semantic palette for a resolved scheme. */
export function paletteFor(scheme: ThemeScheme): SemanticPalette {
  return designTokens.colors[scheme];
}