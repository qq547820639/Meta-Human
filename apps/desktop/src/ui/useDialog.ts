import { useCallback, useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

/** Returns the currently focusable elements inside the given container. */
function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  );
}

/**
 * Modal-dialog focus management:
 * - focuses the first focusable control when the dialog opens,
 * - traps Tab navigation inside the dialog,
 * - closes on Escape (via `onClose`),
 * - returns focus to the previously focused element when the dialog closes.
 *
 * The consumer must keep the dialog mounted across its open/closed lifecycle
 * (pass an `open` flag that renders nothing when false) so the focus-restore
 * effect fires on the transition instead of a component unmount.
 */
export function useDialog(open: boolean, onClose: () => void) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Remember the trigger and focus the first control on open.
  useEffect(() => {
    if (!open) {
      return;
    }
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const target = getFocusable(container)[0] ?? container;
    target.focus();
  }, [open]);

  // Restore focus to the trigger when the dialog closes.
  useEffect(() => {
    if (open) {
      return;
    }
    previousFocusRef.current?.focus();
    previousFocusRef.current = null;
  }, [open]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }
      const container = containerRef.current;
      if (!container) {
        return;
      }
      const focusable = getFocusable(container);
      if (focusable.length === 0) {
        event.preventDefault();
        container.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey) {
        if (active === first || !container.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last || !container.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  return { containerRef, handleKeyDown };
}