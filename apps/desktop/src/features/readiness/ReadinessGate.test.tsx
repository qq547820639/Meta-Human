import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ReadinessGate from "./ReadinessGate";
import type { ReadinessSnapshot } from "./types";

const blockedSnapshot: ReadinessSnapshot = {
  requirements: [
    { id: "conversation", required: true, state: "passed" },
    { id: "voicePresence", required: true, state: "checking" },
    { id: "knowledge", required: true, state: "needsAction" },
  ],
  canCreate: false,
};

const readySnapshot: ReadinessSnapshot = {
  requirements: blockedSnapshot.requirements.map((requirement) => ({
    ...requirement,
    state: "passed",
  })),
  canCreate: true,
};

afterEach(cleanup);

describe("ReadinessGate", () => {
  it("presents human outcomes and honest readiness stages", () => {
    render(<ReadinessGate snapshot={blockedSnapshot} />);

    expect(screen.getAllByText("能够对话").length).toBeGreaterThan(0);
    expect(screen.getAllByText("能够听说和呈现").length).toBeGreaterThan(0);
    expect(screen.getAllByText("能够使用知识").length).toBeGreaterThan(0);
    expect(screen.getByText("已准备好")).toBeInTheDocument();
    expect(screen.getByText("正在确认")).toBeInTheDocument();
    expect(screen.getByText("需要你的帮助")).toBeInTheDocument();

    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+\s*%/)).not.toBeInTheDocument();
  });

  it("keeps creation locked when no creation handler exists", () => {
    render(<ReadinessGate snapshot={readySnapshot} />);
    const action = screen.getByRole("button", {
      name: "创建我的数字人",
    });

    expect(action).toBeDisabled();
  });

  it("enables creation and invokes its handler exactly once", () => {
    const onCreate = vi.fn();
    render(<ReadinessGate snapshot={readySnapshot} onCreate={onCreate} />);
    const action = screen.getByRole("button", {
      name: "创建我的数字人",
    });

    expect(action).toBeEnabled();
    fireEvent.click(action);
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it("uses plural-neutral help copy for multiple needs-action items", () => {
    render(
      <ReadinessGate
        snapshot={{
          requirements: blockedSnapshot.requirements.map((requirement) => ({
            ...requirement,
            state:
              requirement.id === "voicePresence" ? "checking" : "needsAction",
          })),
          canCreate: false,
        }}
      />,
    );

    expect(
      screen.getByText("有些准备需要你的帮助，处理好后即可继续。"),
    ).toBeInTheDocument();
    expect(screen.getByText(/准备进度：0\/3/)).toBeInTheDocument();
    expect(
      screen.queryByText("有一项准备需要你的帮助，处理好后即可继续。"),
    ).not.toBeInTheDocument();
  });

  it("keeps technical information behind a closed native disclosure", () => {
    render(<ReadinessGate snapshot={blockedSnapshot} />);

    const summary = screen.getByText("技术详情");
    const disclosure = summary.closest("details");

    expect(disclosure).toBeInstanceOf(HTMLDetailsElement);
    expect(disclosure).not.toHaveAttribute("open");
  });

  it("shows at most one recommended recovery action and resumes exactly once", () => {
    const onResume = vi.fn();
    render(
      <ReadinessGate
        snapshot={blockedSnapshot}
        recommendedAction="在系统设置中允许麦克风访问。"
        onResume={onResume}
      />,
    );

    expect(
      screen.getAllByText("在系统设置中允许麦克风访问。"),
    ).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "重新确认准备状态" }));
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it("shows a data-routing disclosure when provided", () => {
    render(
      <ReadinessGate
        snapshot={blockedSnapshot}
        privacyNote="声音和形象只会发送到你选择的服务。"
      />,
    );

    expect(
      screen.getByText("声音和形象只会发送到你选择的服务。"),
    ).toBeInTheDocument();
  });
});
