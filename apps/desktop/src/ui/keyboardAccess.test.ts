import { describe, expect, it } from "vitest";

import { validateKeyboardAccess } from "./keyboardAccess";

describe("validateKeyboardAccess", () => {
  it("passes when every keyboard requirement is satisfied", () => {
    const result = validateKeyboardAccess({
      allInteractiveHaveTabIndex: true,
      noKeyboardTrap: true,
      visibleFocus: true,
    });
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("reports a missing tabindex", () => {
    const result = validateKeyboardAccess({
      allInteractiveHaveTabIndex: false,
      noKeyboardTrap: true,
      visibleFocus: true,
    });
    expect(result.ok).toBe(false);
    expect(result.issues).toContain("missing-tabindex");
  });

  it("reports a keyboard trap", () => {
    const result = validateKeyboardAccess({
      allInteractiveHaveTabIndex: true,
      noKeyboardTrap: false,
      visibleFocus: true,
    });
    expect(result.ok).toBe(false);
    expect(result.issues).toContain("keyboard-trap");
  });

  it("reports missing visible focus", () => {
    const result = validateKeyboardAccess({
      allInteractiveHaveTabIndex: true,
      noKeyboardTrap: true,
      visibleFocus: false,
    });
    expect(result.ok).toBe(false);
    expect(result.issues).toContain("missing-visible-focus");
  });

  it("reports every issue together when all fail", () => {
    const result = validateKeyboardAccess({
      allInteractiveHaveTabIndex: false,
      noKeyboardTrap: false,
      visibleFocus: false,
    });
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual([
      "missing-tabindex",
      "keyboard-trap",
      "missing-visible-focus",
    ]);
  });
});