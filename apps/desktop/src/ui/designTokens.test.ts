import { describe, expect, it } from "vitest";

import {
  designTokens,
  paletteFor,
  resolveTheme,
  token,
  tokenNames,
} from "./designTokens";

describe("resolveTheme", () => {
  it("honours an explicit light preference", () => {
    expect(resolveTheme("light", "dark")).toBe("light");
  });

  it("honours an explicit dark preference", () => {
    expect(resolveTheme("dark", "light")).toBe("dark");
  });

  it("defers to the system scheme", () => {
    expect(resolveTheme("system", "light")).toBe("light");
    expect(resolveTheme("system", "dark")).toBe("dark");
  });
});

describe("token", () => {
  it("exposes spacing, typography, radius, shadow and motion values", () => {
    expect(token("spacing.md")).toBe("0.75rem");
    expect(token("typography.fontSizeBase")).toBe("1rem");
    expect(token("radius.lg")).toBe("0.75rem");
    expect(token("shadow.md")).not.toBe("");
    expect(token("motion.fast")).toBe("120ms");
  });

  it("exposes colour tokens for both schemes", () => {
    expect(token("colors.light.background")).toBe("#f6f5ef");
    expect(token("colors.dark.background")).toBe("#26241f");
  });
});

describe("token presence", () => {
  it("covers every required token group", () => {
    const names = tokenNames();
    for (const group of [
      "spacing",
      "typography",
      "radius",
      "shadow",
      "motion",
      "colors",
    ]) {
      expect(names.some((name) => name.startsWith(`${group}.`))).toBe(true);
    }
  });

  it("exposes every semantic colour key in both palettes", () => {
    const semantic = [
      "background",
      "surface",
      "text",
      "muted",
      "line",
      "primary",
      "primaryDeep",
      "error",
      "success",
      "warning",
    ];
    for (const scheme of ["light", "dark"] as const) {
      for (const key of semantic) {
        expect(token(`colors.${scheme}.${key}`)).not.toBe("");
      }
    }
  });
});

describe("palette contrast", () => {
  it("dark and light palettes differ", () => {
    const light = paletteFor("light");
    const dark = paletteFor("dark");
    expect(light.background).not.toBe(dark.background);
    expect(light.text).not.toBe(dark.text);
    expect(light).not.toBe(dark);
  });

  it("marks the semantic tokens explicitly", () => {
    expect(paletteFor("light").primary).toBe(designTokens.colors.light.primary);
  });
});