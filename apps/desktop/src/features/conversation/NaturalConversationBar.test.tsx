import { cleanup, render, screen } from "@testing-library/react";
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
    naturalState: state("idle"),
    onEnableNatural: vi.fn(),
    onDisableNatural: vi.fn(),
    onSetMode: vi.fn(),
    onRetry: vi.fn(),
    onTranscriptEdit: vi.fn(),
    onTranscriptConfirm: vi.fn(),
    onInterrupt: vi.fn(),
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