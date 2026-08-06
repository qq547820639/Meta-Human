import { describe, expect, it } from "vitest";

import {
  focusTrapGuardBounds,
  nextFocusable,
  visibleFocusCheck,
} from "./focusRules";

describe("focusTrapGuardBounds", () => {
  it("accepts a closed trap", () => {
    expect(
      focusTrapGuardBounds({
        isTrapOpen: false,
        hasVisibleFocus: false,
        activeElementInTrap: false,
      }),
    ).toEqual({ trapOk: true, reason: null });
  });

  it("accepts an open trap with visible focus inside it", () => {
    expect(
      focusTrapGuardBounds({
        isTrapOpen: true,
        hasVisibleFocus: true,
        activeElementInTrap: true,
      }),
    ).toEqual({ trapOk: true, reason: null });
  });

  it("flags a missing visible focus indicator", () => {
    expect(
      focusTrapGuardBounds({
        isTrapOpen: true,
        hasVisibleFocus: false,
        activeElementInTrap: true,
      }),
    ).toEqual({ trapOk: false, reason: "no-visible-focus" });
  });

  it("flags focus that escaped outside the trap", () => {
    expect(
      focusTrapGuardBounds({
        isTrapOpen: true,
        hasVisibleFocus: true,
        activeElementInTrap: false,
      }),
    ).toEqual({ trapOk: false, reason: "focus-outside-trap" });
  });
});

describe("nextFocusable", () => {
  const order = ["a", "b", "c"] as const;

  it("moves forward and wraps to the start", () => {
    expect(nextFocusable(order, 0, "next")).toBe(1);
    expect(nextFocusable(order, 2, "next")).toBe(0);
  });

  it("moves backward and wraps to the end", () => {
    expect(nextFocusable(order, 2, "prev")).toBe(1);
    expect(nextFocusable(order, 0, "prev")).toBe(2);
  });

  it("resolves an out-of-range current index", () => {
    expect(nextFocusable(order, -1, "next")).toBe(0);
    expect(nextFocusable(order, -1, "prev")).toBe(2);
    expect(nextFocusable(order, 99, "next")).toBe(0);
  });

  it("returns -1 for an empty list", () => {
    expect(nextFocusable([], 0, "next")).toBe(-1);
  });
});

describe("visibleFocusCheck", () => {
  it("enables focus when an outline is configured", () => {
    expect(visibleFocusCheck({ outlineEnabled: true, reducedMotion: false })).toBe(
      true,
    );
  });

  it("keeps focus visible under reduced motion", () => {
    expect(visibleFocusCheck({ outlineEnabled: true, reducedMotion: true })).toBe(
      true,
    );
  });

  it("disables focus when no outline is configured", () => {
    expect(
      visibleFocusCheck({ outlineEnabled: false, reducedMotion: true }),
    ).toBe(false);
  });
});