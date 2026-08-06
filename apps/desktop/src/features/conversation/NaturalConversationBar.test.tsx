import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import NaturalConversationBar from "./NaturalConversationBar";
import type { NaturalConversationState } from "./natural/naturalConversationStateMachine";

afterEach(cleanup);

function state(
  phase: NaturalConversationState["phase"],
): NaturalConversationState {
  return {
    phase,
    inputMode: "natural",
    userSpeaking: false,
    transcript: "",
    transcriptFinal: false,
    reconnectAttempts: 0,
    errorMessage: null,
  };
}

function baseProps(overrides: Partial<Parameters<typeof NaturalConversationBar>[0]> = {}) {
  return {
    naturalActive: false,
    naturalStatus: "自然对话已关闭",
    naturalTranscript: "",
    naturalMode: "natural" as const,
    naturalSttAvailable: true,
    recommendedMode: "natural" as const,
    micDenied: false,
    micDeniedReason: null,
    naturalState: state("idle"),
    onEnableNatural: vi.fn(),
    onDisableNatural: vi.fn(),
    onSetMode: vi.fn(),
    onRetry: vi.fn(),
    onTranscriptEdit: vi.fn(),
    onTranscriptConfirm: vi.fn(),
    onInterrupt: vi.fn(),
    onOpenMicSettings: vi.fn(),
    ...overrides,
  };
}

describe("NaturalConversationBar accessibility", () => {
  it("exposes an accessible enable control and mode selector when inactive", () => {
    render(<NaturalConversationBar {...baseProps()} />);
    expect(
      screen.getByRole("button", { name: "开启自然对话" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("输入方式")).toBeInTheDocument();
  });

  it("announces the live phase through a polite status live region", () => {
    render(
      <NaturalConversationBar
        {...baseProps({
          naturalActive: true,
          naturalStatus: "正在聆听…",
          naturalState: state("listening"),
        })}
      />,
    );
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("正在聆听…");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveAttribute("aria-label", "自然对话状态");
  });

  it("labels the interim voice-transcription text and exposes confirm", () => {
    render(
      <NaturalConversationBar
        {...baseProps({
          naturalActive: true,
          naturalStatus: "正在聆听…",
          naturalTranscript: "临时转写内容",
          naturalState: state("listening"),
        })}
      />,
    );
    const transcript = screen.getByLabelText("语音转写临时文本");
    expect(transcript).toHaveAttribute("aria-live", "polite");
    expect(transcript).toHaveValue("临时转写内容");
    expect(
      screen.getByRole("button", { name: "确认发送" }),
    ).toBeInTheDocument();
  });

  it("offers a keyboard-focusable interrupt control while speaking/thinking", () => {
    render(
      <NaturalConversationBar
        {...baseProps({
          naturalActive: true,
          naturalStatus: "正在说话…",
          naturalState: state("speaking"),
        })}
      />,
    );
    const interrupt = screen.getByRole("button", { name: "打断" });
    interrupt.focus();
    expect(interrupt).toHaveFocus();
  });

  it("offers a keyboard-focusable retry control in the error phase", () => {
    render(
      <NaturalConversationBar
        {...baseProps({
          naturalActive: true,
          naturalStatus: "连接中断",
          naturalState: state("error"),
        })}
      />,
    );
    const retry = screen.getByRole("button", { name: "重试" });
    retry.focus();
    expect(retry).toHaveFocus();
  });
});

describe("NaturalConversationBar — input modes & permission recovery", () => {
  it("offers the three input modes including 纯文字", () => {
    render(<NaturalConversationBar {...baseProps()} />);
    expect(
      screen.getByRole("option", { name: "自然对话（自动）" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "按住说话" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "纯文字" })).toBeInTheDocument();
  });

  it("surfaces a recommended input mode when it differs from the current one", () => {
    render(
      <NaturalConversationBar
        {...baseProps({
          naturalMode: "natural",
          recommendedMode: "text_only",
        })}
      />,
    );
    expect(screen.getByText(/建议：纯文字/)).toBeInTheDocument();
  });

  it("shows the 已降级为文字 hint when speech is unavailable", () => {
    render(
      <NaturalConversationBar
        {...baseProps({ naturalSttAvailable: false })}
      />,
    );
    expect(screen.getAllByText(/已降级为文字/).length).toBeGreaterThan(0);
  });

  it("shows a degraded hint and mode hint when text_only is selected", () => {
    render(
      <NaturalConversationBar
        {...baseProps({ naturalMode: "text_only", recommendedMode: "natural" })}
      />,
    );
    expect(screen.getByText(/当前为纯文字输入/)).toBeInTheDocument();
  });

  it("surfaces a structured mic-denied message and opens OS settings", () => {
    const onOpenMicSettings = vi.fn();
    render(
      <NaturalConversationBar
        {...baseProps({
          micDenied: true,
          micDeniedReason: "麦克风权限被拒绝，无法进入自然对话。",
          onOpenMicSettings,
        })}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "麦克风权限被拒绝，无法进入自然对话。",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "打开系统麦克风设置" }),
    );
    expect(onOpenMicSettings).toHaveBeenCalledTimes(1);
  });

  it("offers a 清空 (undo) affordance that clears the editable transcript", () => {
    const onTranscriptEdit = vi.fn();
    render(
      <NaturalConversationBar
        {...baseProps({
          naturalActive: true,
          naturalStatus: "正在聆听…",
          naturalTranscript: "临时转写内容",
          naturalState: state("listening"),
          onTranscriptEdit,
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "清空" }));
    expect(onTranscriptEdit).toHaveBeenCalledWith("");
  });
});