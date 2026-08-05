import type { ReactNode } from "react";
import { useDialog } from "./useDialog";

interface ConfirmDialogProps {
  readonly open: boolean;
  readonly title: string;
  readonly titleId: string;
  /** Called when the user presses Escape. */
  readonly onClose: () => void;
  readonly children: ReactNode;
}

/**
 * Accessible modal dialog wrapper: exposes `role="dialog"`,
 * `aria-modal="true"` and an `aria-labelledby` title, traps Tab inside the
 * dialog, closes on Escape, moves focus to the first control on open and
 * returns focus to the trigger on close. Renders nothing when `open` is false
 * but must stay mounted so the focus-restore effect can run.
 */
export default function ConfirmDialog({
  open,
  title,
  titleId,
  onClose,
  children,
}: ConfirmDialogProps) {
  const { containerRef, handleKeyDown } = useDialog(open, onClose);
  if (!open) {
    return null;
  }
  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="conversation-modal"
      onKeyDown={handleKeyDown}
    >
      <div className="conversation-modal-panel">
        <h2 id={titleId}>{title}</h2>
        {children}
      </div>
    </div>
  );
}