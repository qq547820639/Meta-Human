/**
 * Keyboard-accessibility validation.
 *
 * Aggregates the individual keyboard-a11y signals (operable controls, no
 * focus trap, visible focus) into a single pass/fail verdict with a stable
 * list of issues. Pure; the UI feeds in boolean observations.
 */

export interface KeyboardAccessInput {
  /** Whether every interactive element is reachable by Tab (has a tabindex or is natively focusable). */
  readonly allInteractiveHaveTabIndex: boolean;
  /** Whether keyboard focus never gets stuck inside a trap. */
  readonly noKeyboardTrap: boolean;
  /** Whether a visible focus indicator is shown for the focused element. */
  readonly visibleFocus: boolean;
}

export interface KeyboardAccessResult {
  readonly ok: boolean;
  /** Stable machine-readable identifiers of each failing requirement. */
  readonly issues: readonly string[];
}

const MISSING_TABINDEX = "missing-tabindex";
const KEYBOARD_TRAP = "keyboard-trap";
const MISSING_VISIBLE_FOCUS = "missing-visible-focus";

/**
 * Validates full-keyboard operability. Returns `ok` only when every signal
 * passes; otherwise the deferred `issues` list names exactly what failed so
 * the UI can repair it.
 */
export function validateKeyboardAccess(
  input: KeyboardAccessInput,
): KeyboardAccessResult {
  const issues: string[] = [];
  if (!input.allInteractiveHaveTabIndex) {
    issues.push(MISSING_TABINDEX);
  }
  if (!input.noKeyboardTrap) {
    issues.push(KEYBOARD_TRAP);
  }
  if (!input.visibleFocus) {
    issues.push(MISSING_VISIBLE_FOCUS);
  }
  return { ok: issues.length === 0, issues };
}