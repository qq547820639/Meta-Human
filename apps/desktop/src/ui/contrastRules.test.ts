import { describe, expect, it } from "vitest";

import {
  contrastRatio,
  errorRequiresNonColorIndicator,
  passesAA,
  scalesWithDynamicFont,
  shouldReduceMotion,
} from "./contrastRules";

describe("contrastRatio", () => {
  it("computes the black-on-white WCAG ratio (~21:1)", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
  });

  it("is symmetric for foreground/background", () => {
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 0);
  });

  it("parses shorthand and rgb() colours interchangeably", () => {
    expect(contrastRatio("#fff", "rgb(0, 0, 0)")).toBeCloseTo(21, 0);
  });

  it("returns 0 for unparseable colours", () => {
    expect(contrastRatio("not-a-color", "#fff")).toBe(0);
    expect(contrastRatio("#fff", "transparent")).toBe(0);
  });
});

describe("passesAA", () => {
  it("requires 4.5:1 for normal text", () => {
    expect(passesAA(4.5, false)).toBe(true);
    expect(passesAA(4.49, false)).toBe(false);
  });

  it("requires 3:1 for large text / UI components", () => {
    expect(passesAA(3, true)).toBe(true);
    expect(passesAA(2.99, true)).toBe(false);
    expect(passesAA(4.5, true)).toBe(true);
  });
});

describe("errorRequiresNonColorIndicator", () => {
  it("flags an error signalled by colour alone", () => {
    expect(
      errorRequiresNonColorIndicator({
        colorOnly: true,
        hasIcon: false,
        hasText: false,
      }),
    ).toBe(true);
  });

  it("accepts an error that also has an icon", () => {
    expect(
      errorRequiresNonColorIndicator({
        colorOnly: true,
        hasIcon: true,
        hasText: false,
      }),
    ).toBe(false);
  });

  it("accepts an error that also has text", () => {
    expect(
      errorRequiresNonColorIndicator({
        colorOnly: true,
        hasIcon: false,
        hasText: true,
      }),
    ).toBe(false);
  });

  it("accepts an error that does not rely on colour", () => {
    expect(
      errorRequiresNonColorIndicator({
        colorOnly: false,
        hasIcon: false,
        hasText: false,
      }),
    ).toBe(false);
  });
});

describe("shouldReduceMotion", () => {
  it("recognises the reduce token", () => {
    expect(shouldReduceMotion("reduce")).toBe(true);
  });

  it("rejects no-preference and empty values", () => {
    expect(shouldReduceMotion("no-preference")).toBe(false);
    expect(shouldReduceMotion("")).toBe(false);
  });
});

describe("scalesWithDynamicFont", () => {
  it("scales a base size by the font factor", () => {
    expect(scalesWithDynamicFont(16, 1.25)).toBe(20);
    expect(scalesWithDynamicFont(16, 1)).toBe(16);
    expect(scalesWithDynamicFont(24, 1.5)).toBe(36);
  });
});