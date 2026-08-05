import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import ConfirmDialog from "./ConfirmDialog";
import accessibilityCss from "./accessibility.css?raw";

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        打开
      </button>
      <ConfirmDialog
        open={open}
        title="确认操作"
        titleId="confirm-title"
        onClose={() => setOpen(false)}
      >
        <button type="button" onClick={() => setOpen(false)}>
          取消
        </button>
        <button type="button">确定</button>
      </ConfirmDialog>
    </div>
  );
}

afterEach(cleanup);

describe("ConfirmDialog accessibility", () => {
  it("exposes role=dialog, aria-modal and a labelled title once open", () => {
    render(<Harness />);
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "打开" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-labelledby", "confirm-title");
    expect(screen.getByRole("heading", { name: "确认操作" })).toBeInTheDocument();
  });

  it("moves focus to the first control on open and restores it on close", () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "打开" });
    trigger.focus();
    fireEvent.click(trigger);

    expect(screen.getByRole("button", { name: "取消" })).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("closes on Escape and restores focus to the trigger", () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "打开" });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("cycles Tab forward and backward inside the dialog (focus trap)", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "打开" }));
    const dialog = screen.getByRole("dialog");
    const cancel = screen.getByRole("button", { name: "取消" });
    const confirm = screen.getByRole("button", { name: "确定" });

    // Focus lands on the first control.
    expect(cancel).toHaveFocus();

    // Tab from the last control wraps to the first.
    confirm.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(cancel).toHaveFocus();

    // Shift+Tab from the first control wraps to the last.
    cancel.focus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(confirm).toHaveFocus();
  });

  it("declares reduced-motion and visible-focus styles in the shared CSS", () => {
    expect(accessibilityCss).toContain("prefers-reduced-motion");
    expect(accessibilityCss).toContain(":focus-visible");
    expect(accessibilityCss).toContain(".conversation-modal");
  });
});