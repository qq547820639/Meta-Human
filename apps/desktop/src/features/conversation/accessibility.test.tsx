import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ConversationWorkspace from "./ConversationWorkspace";
import {
  ConversationStreamEvents,
  streamConversationReply,
} from "./conversationClient";
import {
  clearConversationMessages,
  createConversation,
  listConversations,
  listConversationMessages,
  renameConversation,
} from "./conversationManagementClient";
import { ApiError } from "../../api/client";

// The `?raw` import is empty under vitest CSS handling, so read the real
// stylesheet from disk to assert reduced-motion / high-contrast / font-scaling
// accessibility rules are actually declared.
const accessibilityCss = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../ui/accessibility.css"),
  "utf8",
);

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: vi.fn((path: string) => `asset://${path}`),
}));

vi.mock("./conversationClient", () => ({
  streamConversationReply: vi.fn(),
  stopGenerating: vi.fn(),
  postConversationReply: vi.fn(),
  transcribeRecording: vi.fn(),
}));

vi.mock("./conversationManagementClient", () => ({
  listConversations: vi.fn(),
  searchConversations: vi.fn(),
  createConversation: vi.fn(),
  getConversation: vi.fn(),
  listConversationMessages: vi.fn(),
  renameConversation: vi.fn(),
  archiveConversation: vi.fn(),
  unarchiveConversation: vi.fn(),
  deleteConversation: vi.fn(),
  clearConversationMessages: vi.fn(),
}));

/** Captures the events object passed to each streamConversationReply call. */
function captureStream() {
  const capture: { events: ConversationStreamEvents } = { events: {} };
  vi.mocked(streamConversationReply).mockImplementation(
    async ({ events: nextEvents }) => {
      capture.events = nextEvents ?? {};
    },
  );
  return capture;
}

beforeEach(() => {
  vi.mocked(listConversations).mockResolvedValue({
    items: [],
    hasMore: false,
    total: 0,
  });
  vi.mocked(clearConversationMessages).mockResolvedValue(undefined);
  vi.mocked(renameConversation).mockResolvedValue(undefined);
  vi.mocked(createConversation).mockResolvedValue({ id: "conv-1", name: "" });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("Conversation accessibility", () => {
  it("declares reduced-motion, high-contrast and font-scaling rules in the shared CSS", () => {
    expect(accessibilityCss).toContain("prefers-reduced-motion");
    expect(accessibilityCss).toContain(".natural-conversation-bar");
    expect(accessibilityCss).toContain(".conversation-avatar");
    expect(accessibilityCss).toContain("forced-colors: active");
    expect(accessibilityCss).toContain("CanvasText");
    expect(accessibilityCss).toContain("font-size: 100%");
    expect(accessibilityCss).toContain(":focus-visible");
  });

  it("keeps key actions keyboard-operable: Enter sends, stop is focusable", async () => {
    const capture = captureStream();

    render(<ConversationWorkspace />);

    const textarea = screen.getByLabelText("问题");
    textarea.focus();
    expect(textarea).toHaveFocus();

    fireEvent.change(textarea, { target: { value: "键盘发送" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    capture.events.onGenerationStarted?.("gen-kb");
    capture.events.onToken?.("回答。");

    const stop = screen.getByRole("button", { name: "停止生成" });
    stop.focus();
    expect(stop).toHaveFocus();
    expect(streamConversationReply).toHaveBeenCalledTimes(1);
  });

  it("exposes a polite TTS subtitle mirroring the text being read aloud", async () => {
    const capture = captureStream();
    const { container } = render(<ConversationWorkspace />);

    fireEvent.change(screen.getByLabelText("问题"), {
      target: { value: "你好" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    capture.events.onToken?.("回答。");
    capture.events.onDone?.("回答。");
    capture.events.onAudio?.("QUJD");

    await waitFor(() =>
      expect(container.querySelector("audio")).not.toBeNull(),
    );

    // No subtitle until the audio actually starts playing.
    expect(screen.queryByTestId("tts-subtitle")).toBeNull();

    fireEvent.play(container.querySelector("audio") as HTMLAudioElement);

    const subtitle = screen.getByTestId("tts-subtitle");
    expect(subtitle).toHaveTextContent("数字人正在朗读：回答。");
    // role="status" + aria-live="polite" announce the reading text to
    // screen readers without interrupting ongoing speech output.
    expect(subtitle).toHaveAttribute("aria-live", "polite");
  });

  it("surfaces a readable error state with an accessible alert and retry", async () => {
    const apiError = new ApiError(
      {
        code: "provider_quota",
        message: "今日额度已用完。",
        retryable: true,
        request_id: "req-123",
        recommended_action: "请稍后再试或联系管理员。",
        technical_message: null,
        details: null,
        provider: "openai",
        provider_status: "quota_exceeded",
        timestamp: null,
      },
      429,
    );
    vi.mocked(streamConversationReply).mockRejectedValue(apiError);

    render(<ConversationWorkspace />);
    fireEvent.change(screen.getByLabelText("问题"), {
      target: { value: "你好" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("今日额度已用完。"),
    );
    expect(screen.getByText("此错误可重试。")).toBeInTheDocument();
    expect(screen.getByText("请稍后再试或联系管理员。")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "复制请求编号" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
  });

  it("renders a labelled empty state when there are no messages", () => {
    render(<ConversationWorkspace />);

    expect(
      screen.getByText("你的数字人会在这里回应你。"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("对话")).toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: "建议问题" }),
    ).toBeInTheDocument();
  });

  it("shows recovery fallback notices as live regions for avatar/tts failures", async () => {
    const capture = captureStream();
    const { container } = render(
      <ConversationWorkspace
        portraitPath="/tmp/portrait.jpg"
        session={{
          sessionId: "sess-1",
          streamUrl: "https://gpu.example.com/live/stream-1",
          avatarId: "a1",
          voiceId: "v1",
          status: "ready",
          createdAt: Date.now(),
        }}
      />,
    );

    fireEvent.change(screen.getByLabelText("问题"), {
      target: { value: "你好" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    capture.events.onToken?.("回答。");
    capture.events.onDone?.("回答。");
    capture.events.onAudio?.("QUJD");

    await waitFor(() =>
      expect(container.querySelector("audio")).not.toBeNull(),
    );

    const video = container.querySelector("video");
    fireEvent.error(video as HTMLVideoElement);

    await waitFor(() =>
      expect(
        screen.getByText("数字人暂不可用，已切换为语音播放。"),
      ).toBeInTheDocument(),
    );
    // The fallback notice is a status live region, not blank.
    const live = screen.getByText("数字人暂不可用，已切换为语音播放。");
    expect(live.closest("[role='status']")).not.toBeNull();
  });

  it("restores a conversation and renders its messages with accessible labels", async () => {
    vi.mocked(listConversationMessages).mockResolvedValue({
      messages: [
        { role: "user", content: "昨天问过" },
        { role: "assistant", content: "昨天回答过", grounded: true },
      ],
      nextCursor: null,
      hasMore: false,
    });

    render(<ConversationWorkspace initialConversationId="conv-1" />);

    await waitFor(() => expect(screen.getByText("昨天问过")).toBeInTheDocument());
    expect(screen.getByLabelText("对话记录")).toBeInTheDocument();
    expect(screen.getByText("昨天回答过")).toBeInTheDocument();
  });
});