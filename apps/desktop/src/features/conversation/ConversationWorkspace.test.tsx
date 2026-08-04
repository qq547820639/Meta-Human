import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ConversationWorkspace from "./ConversationWorkspace";
import {
  ConversationStreamEvents,
  postConversationReply,
  stopGenerating,
  streamConversationReply,
} from "./conversationClient";
import {
  archiveConversation,
  clearConversationMessages,
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  renameConversation,
  searchConversations,
  unarchiveConversation,
} from "./conversationManagementClient";
import {
  deleteMediaFile,
  startRecording,
  stopRecording,
} from "../creation/captureClient";
import { ApiError } from "../../api/client";

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
  renameConversation: vi.fn(),
  archiveConversation: vi.fn(),
  unarchiveConversation: vi.fn(),
  deleteConversation: vi.fn(),
  clearConversationMessages: vi.fn(),
}));

vi.mock("../creation/captureClient", () => ({
  startRecording: vi.fn(),
  stopRecording: vi.fn(),
  deleteMediaFile: vi.fn(),
}));

const clipboardWriteText = vi.fn().mockResolvedValue(undefined);

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

function mockReply() {
  vi.mocked(postConversationReply).mockResolvedValue({
    text: "",
    citations: [],
    grounded: false,
  });
}

/** Sets scroll metrics on the thread element so scroll detection is testable. */
function setThreadMetrics(
  thread: HTMLElement,
  scrollHeight: number,
  clientHeight: number,
  scrollTop: number,
) {
  Object.defineProperty(thread, "scrollHeight", {
    value: scrollHeight,
    configurable: true,
  });
  Object.defineProperty(thread, "clientHeight", {
    value: clientHeight,
    configurable: true,
  });
  Object.defineProperty(thread, "scrollTop", {
    value: scrollTop,
    configurable: true,
    writable: true,
  });
}

beforeEach(() => {
  vi.mocked(listConversations).mockResolvedValue([]);
  vi.mocked(clearConversationMessages).mockResolvedValue(undefined);
  vi.mocked(renameConversation).mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: clipboardWriteText },
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.resetAllMocks();
});

describe("ConversationWorkspace", () => {
  it("streams tokens and renders phases from real SSE events", async () => {
    vi.mocked(postConversationReply).mockResolvedValue({
      text: "你好世界。",
      citations: [],
      grounded: false,
    });
    const capture = captureStream();

    render(<ConversationWorkspace />);
    fireEvent.change(screen.getByLabelText("问题"), {
      target: { value: "如何进入？" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("正在理解问题"),
    );

    act(() => capture.events.onStage?.("retrieving"));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("正在检索知识"),
    );

    act(() => capture.events.onFoundSources?.(3));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("找到 3 个相关来源"),
    );

    act(() => capture.events.onToken?.("你好"));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("正在生成回答"),
    );
    expect(screen.getByText("你好")).toBeInTheDocument();

    act(() => capture.events.onToken?.("世界。"));
    await waitFor(() =>
      expect(screen.getByText("你好世界。")).toBeInTheDocument(),
    );

    act(() => capture.events.onDone?.("你好世界。"));
    await waitFor(() =>
      expect(screen.getByText("你好世界。")).toBeInTheDocument(),
    );
  });

  it("restores the most recent conversation on mount", async () => {
    vi.mocked(getConversation).mockResolvedValue({
      id: "conv-1",
      name: "昨天的对话",
      messages: [
        { role: "user", content: "昨天问过" },
        { role: "assistant", content: "昨天回答过", grounded: true },
      ],
    });

    render(<ConversationWorkspace initialConversationId="conv-1" />);

    await waitFor(() =>
      expect(screen.getByText("昨天问过")).toBeInTheDocument(),
    );
    expect(screen.getByText("昨天回答过")).toBeInTheDocument();
  });

  it("clears old messages when a new conversation is created", async () => {
    vi.mocked(getConversation).mockResolvedValue({
      id: "conv-1",
      name: "旧对话",
      messages: [
        { role: "user", content: "旧问题" },
        { role: "assistant", content: "旧回答" },
      ],
    });
    vi.mocked(createConversation).mockResolvedValue({
      id: "conv-2",
      name: "新对话",
    });

    render(<ConversationWorkspace initialConversationId="conv-1" />);
    await waitFor(() => expect(screen.getByText("旧问题")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "新建对话" }));

    await waitFor(() =>
      expect(screen.queryByText("旧问题")).not.toBeInTheDocument(),
    );
    expect(screen.queryByText("旧回答")).not.toBeInTheDocument();
  });

  it("creates a new conversation, shows the empty state and titles it from the first question", async () => {
    vi.mocked(createConversation).mockResolvedValue({ id: "conv-2", name: "" });
    mockReply();
    const capture = captureStream();

    render(<ConversationWorkspace />);
    fireEvent.click(screen.getByRole("button", { name: "新建对话" }));

    await waitFor(() =>
      expect(screen.getByText("你的数字人会在这里回应你。")).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByLabelText("问题"), {
      target: { value: "我的第一个问题" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() =>
      expect(renameConversation).toHaveBeenCalledWith("conv-2", "我的第一个问题"),
    );
    expect(capture.events.onToken).toBeDefined();
  });

  it("stops generation with the real generation_id", async () => {
    const capture = captureStream();
    vi.mocked(stopGenerating).mockResolvedValue(true);

    render(<ConversationWorkspace />);
    fireEvent.change(screen.getByLabelText("问题"), {
      target: { value: "慢慢说" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    capture.events.onGenerationStarted?.("gen-abc");
    capture.events.onToken?.("部分。");

    fireEvent.click(screen.getByRole("button", { name: "停止生成" }));
    expect(stopGenerating).toHaveBeenCalledTimes(1);
    expect(stopGenerating).toHaveBeenCalledWith("gen-abc");
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("已停止生成。"),
    );
  });

  it("keeps the text and reports TTS failure when TTS fails", async () => {
    const capture = captureStream();
    vi.mocked(postConversationReply).mockRejectedValue(new Error("TTS failed"));

    render(<ConversationWorkspace />);
    fireEvent.change(screen.getByLabelText("问题"), {
      target: { value: "你好" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    capture.events.onToken?.("完整回答。");
    capture.events.onDone?.("完整回答。");

    await waitFor(() =>
      expect(screen.getByText("完整回答。")).toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(
        screen.getByText("语音生成失败，已保留文字回答。"),
      ).toBeInTheDocument(),
    );
  });

  it("plays audio and reports avatar unavailability when the avatar stream fails", async () => {
    const capture = captureStream();
    vi.mocked(postConversationReply).mockResolvedValue({
      text: "回答。",
      citations: [],
      grounded: false,
      audioBase64: "QUJD",
    });

    const { container } = render(
      <ConversationWorkspace
        portraitPath="/tmp/portrait.jpg"
        streamUrl="https://gpu.example.com/live/stream-1"
      />,
    );
    fireEvent.change(screen.getByLabelText("问题"), {
      target: { value: "你好" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    capture.events.onToken?.("回答。");
    capture.events.onDone?.("回答。");

    await waitFor(() =>
      expect(container.querySelector("audio")).not.toBeNull(),
    );

    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    fireEvent.error(video as HTMLVideoElement);

    await waitFor(() =>
      expect(
        screen.getByText("数字人暂不可用，已切换为语音播放。"),
      ).toBeInTheDocument(),
    );
    expect(container.querySelector("audio")).not.toBeNull();
  });

  it("copies a single question, a single reply and the full transcript", async () => {
    const capture = captureStream();
    vi.mocked(postConversationReply).mockResolvedValue({
      text: "回答。",
      citations: [],
      grounded: false,
    });

    render(<ConversationWorkspace />);
    fireEvent.change(screen.getByLabelText("问题"), {
      target: { value: "你好" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    capture.events.onToken?.("回答。");
    capture.events.onDone?.("回答。");

    await waitFor(() => expect(screen.getByText("回答。")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "复制回答" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "已复制回答" }),
      ).toBeInTheDocument(),
    );
    expect(clipboardWriteText).toHaveBeenCalledWith("回答。");

    fireEvent.click(screen.getByRole("button", { name: "复制问题" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "已复制问题" }),
      ).toBeInTheDocument(),
    );
    expect(clipboardWriteText).toHaveBeenCalledWith("你好");

    fireEvent.click(screen.getByRole("button", { name: "复制全部" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "已复制全部" }),
      ).toBeInTheDocument(),
    );
    expect(clipboardWriteText).toHaveBeenCalledWith(
      "我: 你好\n\n数字人: 回答。",
    );
  });

  it("regenerates and clearly marks the replacement as re-generated", async () => {
    const firstCapture: { events: ConversationStreamEvents } = { events: {} };
    const secondCapture: { events: ConversationStreamEvents } = { events: {} };
    vi.mocked(streamConversationReply)
      .mockImplementationOnce(async ({ events }) => {
        firstCapture.events = events ?? {};
      })
      .mockImplementationOnce(async ({ events }) => {
        secondCapture.events = events ?? {};
      });
    vi.mocked(postConversationReply).mockResolvedValue({
      text: "第一次回答。",
      citations: [],
      grounded: false,
    });

    render(<ConversationWorkspace />);
    fireEvent.change(screen.getByLabelText("问题"), {
      target: { value: "你好" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    firstCapture.events.onToken?.("第一次回答。");
    firstCapture.events.onDone?.("第一次回答。");
    await waitFor(() =>
      expect(screen.getByText("第一次回答。")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "重新生成" }));

    secondCapture.events.onToken?.("重新生成回答。");
    secondCapture.events.onDone?.("重新生成回答。");
    await waitFor(() =>
      expect(screen.getByText("重新生成回答。")).toBeInTheDocument(),
    );
    expect(screen.queryByText("第一次回答。")).not.toBeInTheDocument();
    expect(screen.getAllByText("你好")).toHaveLength(1);
    expect(screen.getByText("已重新生成")).toBeInTheDocument();
  });

  it("edits a message and regenerates from that node, truncating later messages", async () => {
    const firstCapture: { events: ConversationStreamEvents } = { events: {} };
    const secondCapture: { events: ConversationStreamEvents } = { events: {} };
    vi.mocked(streamConversationReply)
      .mockImplementationOnce(async ({ events }) => {
        firstCapture.events = events ?? {};
      })
      .mockImplementationOnce(async ({ events }) => {
        secondCapture.events = events ?? {};
      });
    vi.mocked(postConversationReply).mockResolvedValue({
      text: "第一次回答。",
      citations: [],
      grounded: false,
    });

    const { container } = render(<ConversationWorkspace />);
    fireEvent.change(screen.getByLabelText("问题"), {
      target: { value: "你好" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    firstCapture.events.onToken?.("第一次回答。");
    firstCapture.events.onDone?.("第一次回答。");
    await waitFor(() =>
      expect(screen.getByText("第一次回答。")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    fireEvent.change(screen.getByLabelText("编辑问题"), {
      target: { value: "你好呀" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存并重新发送" }));

    secondCapture.events.onToken?.("编辑后的回答。");
    secondCapture.events.onDone?.("编辑后的回答。");
    await waitFor(() =>
      expect(screen.getByText("编辑后的回答。")).toBeInTheDocument(),
    );

    expect(screen.queryByText("第一次回答。")).not.toBeInTheDocument();
    expect(screen.getByText("你好呀")).toBeInTheDocument();
    expect(screen.getByText("已重新生成")).toBeInTheDocument();
    expect(container.querySelectorAll(".conversation-message")).toHaveLength(2);
  });

  it("buffers stream tokens and flushes via requestAnimationFrame instead of per token", async () => {
    mockReply();
    const capture = captureStream();

    render(<ConversationWorkspace />);
    fireEvent.change(screen.getByLabelText("问题"), {
      target: { value: "你好" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    // The first token creates the message immediately.
    act(() => {
      capture.events.onToken?.("一");
    });
    expect(screen.getByText("一")).toBeInTheDocument();

    // Subsequent tokens are buffered and not yet flushed to React until the
    // next animation frame, so the accumulated text is not visible yet.
    act(() => {
      capture.events.onToken?.("二");
      capture.events.onToken?.("三");
    });
    expect(screen.queryByText("一二三")).not.toBeInTheDocument();

    // The frame fires and the accumulated tokens are flushed together.
    await waitFor(() => expect(screen.getByText("一二三")).toBeInTheDocument());
  });

  it("auto-follows new tokens when the user is at the bottom", async () => {
    mockReply();
    const capture = captureStream();
    const { container } = render(<ConversationWorkspace />);
    fireEvent.change(screen.getByLabelText("问题"), {
      target: { value: "你好" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    capture.events.onToken?.("你好世界。");
    const thread = container.querySelector(".conversation-thread") as HTMLElement;
    setThreadMetrics(thread, 1000, 200, 0);

    act(() => capture.events.onStage?.("retrieving"));
    expect(thread.scrollTop).toBe(1000);
  });

  it("does not pull the user back when scrolled up and offers a back-to-latest button", async () => {
    mockReply();
    const capture = captureStream();
    const { container } = render(<ConversationWorkspace />);
    fireEvent.change(screen.getByLabelText("问题"), {
      target: { value: "你好" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    capture.events.onToken?.("你好世界。");
    const thread = container.querySelector(".conversation-thread") as HTMLElement;
    setThreadMetrics(thread, 1000, 200, 100);

    fireEvent.scroll(thread);
    expect(
      screen.getByRole("button", { name: "回到最新消息" }),
    ).toBeInTheDocument();

    capture.events.onToken?.("更多内容。");
    act(() => capture.events.onStage?.("retrieving"));
    expect(thread.scrollTop).toBe(100);

    fireEvent.click(screen.getByRole("button", { name: "回到最新消息" }));
    expect(thread.scrollTop).toBe(1000);
    expect(
      screen.queryByRole("button", { name: "回到最新消息" }),
    ).not.toBeInTheDocument();
  });

  it("shows a friendly ApiError with retryable flag, recommended action and a copyable request id", async () => {
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

    fireEvent.click(screen.getByRole("button", { name: "复制请求编号" }));
    await waitFor(() =>
      expect(clipboardWriteText).toHaveBeenCalledWith("req-123"),
    );
  });
});