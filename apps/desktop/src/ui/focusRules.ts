/**
 * Focus-management rules for modal dialogs and keyboard navigation.
 *
 * Pure, deterministic helpers the modal/trap UI layer applies. No browser
 * APIs are touched here; the caller supplies the observed focus state.
 */

export interface FocusTrapBoundsInput {
  /** Whether a modal focus trap is currently open. */
  readonly isTrapOpen: boolean;
  /** Whether the document claims to have a visible focus indicator. */
  readonly hasVisibleFocus: boolean;
  /** Whether `document.activeElement` is inside the trap container. */
  readonly activeElementInTrap: boolean;
}

export interface FocusTrapGuardResult {
  readonly trapOk: boolean;
  /** Stable machine-readable reason for a failed trap, or null when ok. */
  readonly reason: string | null;
}

/**
 * Validates a modal focus trap. When the trap is open, focus must be both
 * visible and inside the trap; otherwise the dialog can be lost to the
 * background content. A closed trap is always valid.
 */
export function focusTrapGuardBounds(
  input: FocusTrapBoundsInput,
): FocusTrapGuardResult {
  if (!input.isTrapOpen) {
    return { trapOk: true, reason: null };
  }
  if (!input.hasVisibleFocus) {
    return { trapOk: false, reason: "no-visible-focus" };
  }
  if (!input.activeElementInTrap) {
    return { trapOk: false, reason: "focus-outside-trap" };
  }
  return { trapOk: true, reason: null };
}

export type FocusDirection = "prev" | "next";

/**
 * Circular focus navigation. Given an ordered list of focusable targets and
 * the index of the currently focused item, returns the index to move to,
 * wrapping from the last to the first (and vice-versa). An empty list yields
 * -1; an out-of-range current index resolves to the first (next) or last
 * (prev) item.
 */
export function nextFocusable(
  selectorOrder: readonly unknown[],
  currentIndex: number,
  direction: FocusDirection,
): number {
  const count = selectorOrder.length;
  if (count === 0) {
    return -1;
  }
  if (currentIndex < 0 || currentIndex >= count) {
    return direction === "next" ? 0 : count - 1;
  }
  return direction === "next"
    ? (currentIndex + 1) % count
    : (currentIndex - 1 + count) % count;
}

export interface VisibleFocusInput {
  /** Whether a visible focus outline/ring is configured for interactive items. */
  readonly outlineEnabled: boolean;
  /** Whether the user prefers reduced motion. */
  readonly reducedMotion: boolean;
}

/**
 * Whether visible focus indicators are enabled. Focus rings are functional
 * affordances, not decorative motion: a reduced-motion preference must never
 * suppress them, so only the `outlineEnabled` flag decides the outcome.
 */
export function visibleFocusCheck(input: VisibleFocusInput): boolean {
  return input.outlineEnabled;
}