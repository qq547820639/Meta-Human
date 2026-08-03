import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import type { UseReadinessResult } from "./features/readiness/useReadiness";
import { useReadiness } from "./features/readiness/useReadiness";

vi.mock("./features/readiness/useReadiness", () => ({
  useReadiness: vi.fn(),
}));

vi.mock("./features/settings/Settings", () => ({
  default: () => <div>设置界面</div>,
}));

const requirements = [
  { id: "conversation" as const, required: true, state: "passed" as const },
  { id: "voicePresence" as const, required: true, state: "passed" as const },
  { id: "knowledge" as const, required: true, state: "passed" as const },
];

function hookResult(
  overrides: Partial<UseReadinessResult> = {},
): UseReadinessResult {
  return {
    snapshot: null,
    sidecarSnapshot: null,
    error: null,
    isLoading: false,
    recommendedAction: null,
    resume: vi.fn(),
    ...overrides,
  };
}

afterEach(cleanup);

describe("App", () => {
  beforeEach(() => {
    vi.mocked(useReadiness).mockReset();
  });

  it("shows the honest loading state while live readiness is unresolved", () => {
    vi.mocked(useReadiness).mockReturnValue(hookResult({ isLoading: true }));

    render(<App />);

    expect(screen.getByText("正在确认工作室是否准备就绪…")).toBeInTheDocument();
    expect(screen.queryByText("能够对话")).not.toBeInTheDocument();
  });

  it("fails closed with a safe error and wires retry to resume", () => {
    const resume = vi.fn();
    vi.mocked(useReadiness).mockReturnValue(
      hookResult({
        error: {
          code: "readiness_unavailable",
          message: "无法确认工作室准备状态。",
          retryable: true,
        },
        resume,
      }),
    );

    render(<App />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "暂时无法确认准备状态",
    );
    fireEvent.click(screen.getByRole("button", { name: "重新确认准备状态" }));
    expect(resume).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("button", { name: "创建我的数字人" }),
    ).not.toBeInTheDocument();
  });

  it("shows one recommended action and keeps a blocked gate disabled", () => {
    const resume = vi.fn();
    vi.mocked(useReadiness).mockReturnValue(
      hookResult({
        snapshot: {
          requirements: requirements.map((requirement) => ({
            ...requirement,
            state:
              requirement.id === "voicePresence" ? "needsAction" : "passed",
          })),
          canCreate: false,
        },
        recommendedAction: "在系统设置中允许麦克风访问。",
        resume,
      }),
    );

    render(<App />);

    expect(
      screen.getAllByText("在系统设置中允许麦克风访问。"),
    ).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "创建我的数字人" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "重新确认准备状态" }));
    expect(resume).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "去设置" }));
    expect(screen.getByText("设置界面")).toBeInTheDocument();
  });

  it("offers a generic recovery action when a blocked gate needs help without one", () => {
    const resume = vi.fn();
    vi.mocked(useReadiness).mockReturnValue(
      hookResult({
        snapshot: {
          requirements: requirements.map((requirement) => ({
            ...requirement,
            state:
              requirement.id === "voicePresence" ? "needsAction" : "passed",
          })),
          canCreate: false,
        },
        resume,
      }),
    );

    render(<App />);

    expect(
      screen.getByRole("button", { name: "重新确认准备状态" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新确认准备状态" }));
    expect(resume).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: "创建我的数字人" }),
    ).toBeDisabled();
  });

  it("does not offer a futile retry when the sidecar failed closed", () => {
    vi.mocked(useReadiness).mockReturnValue(
      hookResult({
        error: {
          code: "readiness_failed_closed",
          message: "The readiness service stopped.",
          retryable: false,
        },
      }),
    );

    render(<App />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "准备服务已停止，请重新打开应用。",
    );
    expect(
      screen.queryByRole("button", { name: "重新确认准备状态" }),
    ).not.toBeInTheDocument();
  });

  it("genuinely enables an all-passed gate and acknowledges creation", () => {
    vi.mocked(useReadiness).mockReturnValue(
      hookResult({
        snapshot: { requirements, canCreate: true },
      }),
    );

    render(<App />);
    const create = screen.getByRole("button", { name: "创建我的数字人" });

    expect(create).toBeEnabled();
    fireEvent.click(create);

    expect(screen.getByLabelText("创建数字人")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: "塑造你的数字人" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "创建我的数字人" }),
    ).toBeDisabled();
  });

  it("opens the settings view from the header", () => {
    vi.mocked(useReadiness).mockReturnValue(hookResult());

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "设置" }));

    expect(screen.getByText("设置界面")).toBeInTheDocument();
  });
});
