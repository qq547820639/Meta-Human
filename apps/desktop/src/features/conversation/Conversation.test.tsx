import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convertFileSrc } from "@tauri-apps/api/core";

import Conversation from "./Conversation";
import {
  deleteMediaFile,
  startRecording,
  stopRecording,
} from "../creation/captureClient";
import {
  clearConversationHistory,
  listConversationHistory,
  postConversationReply,
  transcribeRecording,
} from "./conversationClient";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: vi.fn((path: string) => `asset://${path}`),
}));

vi.mock("./conversationClient", () => ({
  listConversationHistory: vi.fn(),
  clearConversationHistory: vi.fn(),
  postConversationReply: vi.fn(),
  transcribeRecording: vi.fn(),
}));

vi.mock("../creation/captureClient", () => ({
  startRecording: vi.fn(),
  stopRecording: vi.fn(),
  deleteMediaFile: vi.fn(),
}));

const clipboardWriteText = vi.fn().mockResolvedValue(undefined);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  vi.mocked(listConversationHistory).mockResolvedValue({ messages: [] });
  vi.mocked(clearConversationHistory).mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: clipboardWriteText },
    configurable: true,
  });
});

describe("Conversation", () => {
  it("shows a grounded reply with citations", async () => {
    vi.mocked(postConversationReply).mockResolvedValue({
      text: "后入式进入。",
      citations: ["[Wearable Guide]"],
      grounded: true,
      citationUrls: ["https://feishu.cn/docx/doc-1"],
    });

    render(<Conversation />);
    fireEvent.change(screen.getByLabelText("问题"), {
      target: { value: "如何进入？" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() =>
      expect(screen.getByText("后入式进入。")).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("link", { name: "[Wearable Guide]" }),
    ).toHaveAttribute("href", "https://feishu.cn/docx/doc-1");
  });

  it("fails closed and keeps the input recoverable", async () => {
    vi.mocked(postConversationReply).mockRejectedValue(
      new Error("对话服务暂时无法回复。"),
    );

    render(<Conversation />);
    fireEvent.change(screen.getByLabelText("问题"), {
      target: { value: "你好" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "对话服务暂时无法回复。",
      ),
    );
    expect(screen.getByLabelText("问题")).toHaveValue("你好");
  });

  it("offers retry after a failed reply and recovers", async () => {
    vi.mocked(postConversationReply)
      .mockRejectedValueOnce(new Error("对话服务暂时无法回复。"))
      .mockResolvedValueOnce({
        text: "重试成功。",
        citations: [],
        grounded: false,
      });

    render(<Conversation />);
    fireEvent.change(screen.getByLabelText("问题"), {
      target: { value: "你好" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "对话服务暂时无法回复。",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "重试" }));

    await waitFor(() =>
      expect(screen.getByText("重试成功。")).toBeInTheDocument(),
    );
    expect(postConversationReply).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("button", { name: "重试" })).not.toBeInTheDocument();
  });

  it("regenerates the last assistant reply without duplicating the question", async () => {
    vi.mocked(postConversationReply)
      .mockResolvedValueOnce({
        text: "第一次回答。",
        citations: [],
        grounded: false,
      })
      .mockResolvedValueOnce({
        text: "重新生成回答。",
        citations: [],
        grounded: false,
      });

    render(<Conversation />);
    fireEvent.change(screen.getByLabelText("问题"), {
      target: { value: "你好" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() =>
      expect(screen.getByText("第一次回答。")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "重新生成" }));

    await waitFor(() =>
      expect(screen.getByText("重新生成回答。")).toBeInTheDocument(),
    );
    expect(screen.queryByText("第一次回答。")).not.toBeInTheDocument();
    expect(screen.getAllByText("你好")).toHaveLength(1);
    expect(postConversationReply).toHaveBeenCalledTimes(2);
  });

  it("keeps a multi-turn history and lets the user clear it", async () => {
    vi.mocked(listConversationHistory).mockResolvedValue({
      messages: [],
    });
    vi.mocked(postConversationReply)
      .mockResolvedValueOnce({
        text: "第一次回应。",
        citations: [],
        grounded: false,
      })
      .mockResolvedValueOnce({
        text: "第二次回应。",
        citations: ["[Knowledge Base]"],
        grounded: true,
      });

    render(<Conversation />);

    fireEvent.change(screen.getByLabelText("问题"), {
      target: { value: "你好" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() =>
      expect(screen.getByText("第一次回应。")).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByLabelText("问题"), {
      target: { value: "再问一次" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() =>
      expect(screen.getByText("第二次回应。")).toBeInTheDocument(),
    );

    expect(screen.getByText("你好")).toBeInTheDocument();
    expect(screen.getByText("再问一次")).toBeInTheDocument();
    expect(screen.getByText(/Knowledge Base/)).toBeInTheDocument();
    expect(postConversationReply).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("button", { name: "清空对话" }));
    expect(screen.getByText("你好")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认清空？" }));
    expect(screen.queryByText("你好")).not.toBeInTheDocument();
    expect(screen.queryByText("第一次回应。")).not.toBeInTheDocument();
    expect(clearConversationHistory).toHaveBeenCalledTimes(1);
  });

  it("captures and transcribes a voice question", async () => {
    vi.mocked(startRecording).mockResolvedValue(undefined);
    vi.mocked(stopRecording).mockResolvedValue("/tmp/voice.wav");
    vi.mocked(transcribeRecording).mockResolvedValue("语音问题");
    vi.mocked(deleteMediaFile).mockResolvedValue(undefined);

    render(<Conversation />);
    fireEvent.click(screen.getByRole("button", { name: "语音提问" }));
    expect(startRecording).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "停止录音" })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "停止录音" }));

    await waitFor(() =>
      expect(screen.getByLabelText("问题")).toHaveValue("语音问题"),
    );
    expect(stopRecording).toHaveBeenCalledTimes(1);
    expect(transcribeRecording).toHaveBeenCalledWith("/tmp/voice.wav");
    expect(deleteMediaFile).toHaveBeenCalledWith("/tmp/voice.wav");
  });

  it("renders a live avatar stream when the provider returns a URL", () => {
    const { container } = render(
      <Conversation
        portraitPath="/tmp/portrait.jpg"
        streamUrl="https://gpu.example.com/live/stream-1"
      />,
    );

    expect(container.querySelector("video")).not.toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  it("falls back to the portrait when the avatar stream fails", () => {
    const { container } = render(
      <Conversation
        portraitPath="/tmp/portrait.jpg"
        streamUrl="https://gpu.example.com/live/stream-1"
      />,
    );

    fireEvent.error(container.querySelector("video") as HTMLVideoElement);

    expect(container.querySelector("img")).not.toBeNull();
    expect(
      screen.getByText("实时形象暂时不可用，已切换为人像。"),
    ).toBeInTheDocument();
  });

  it("fills the composer from a suggested question", () => {
    render(<Conversation />);

    fireEvent.click(
      screen.getByRole("button", { name: "我的数字人是怎么创建的？" }),
    );

    expect(screen.getByLabelText("问题")).toHaveValue(
      "我的数字人是怎么创建的？",
    );
  });

  it("shows an honest thinking state and disables sending while loading", async () => {
    let resolveReply!: (reply: {
      text: string;
      citations: string[];
      grounded: boolean;
    }) => void;
    vi.mocked(postConversationReply).mockReturnValue(
      new Promise((resolve) => {
        resolveReply = resolve;
      }),
    );

    render(<Conversation />);
    fireEvent.change(screen.getByLabelText("问题"), {
      target: { value: "慢慢想" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    expect(screen.getByRole("status")).toHaveTextContent("正在思考…");
    expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "停止生成" }),
    ).toBeInTheDocument();

    resolveReply({
      text: "想好了。",
      citations: [],
      grounded: false,
    });
    await waitFor(() =>
      expect(screen.getByText("想好了。")).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "发送" })).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "停止生成" }),
    ).not.toBeInTheDocument();
  });

  it("plays synthesized audio when the provider returns it", async () => {
    vi.mocked(postConversationReply).mockResolvedValue({
      text: "你好。",
      citations: [],
      grounded: false,
      audioBase64: "QUJD",
    });

    const { container } = render(<Conversation />);
    fireEvent.change(screen.getByLabelText("问题"), {
      target: { value: "说句话" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() =>
      expect(container.querySelector("audio")).not.toBeNull(),
    );
    expect(container.querySelector("audio")?.getAttribute("src")).toBe(
      "data:audio/wav;base64,QUJD",
    );
  });

  it("shows the captured portrait as the digital human presence", () => {
    vi.mocked(listConversationHistory).mockResolvedValue({
      messages: [],
    });
    render(<Conversation portraitPath="/tmp/portrait.jpg" />);

    expect(screen.getByAltText("你的数字人人像")).toHaveAttribute(
      "src",
      "asset:///tmp/portrait.jpg",
    );
    expect(convertFileSrc).toHaveBeenCalledWith("/tmp/portrait.jpg");
  });

  it("marks the portrait as speaking while audio plays", async () => {
    vi.mocked(listConversationHistory).mockResolvedValue({
      messages: [],
    });
    vi.mocked(postConversationReply).mockResolvedValue({
      text: "你好。",
      citations: [],
      grounded: false,
      audioBase64: "QUJD",
    });

    const { container } = render(
      <Conversation portraitPath="/tmp/portrait.jpg" />,
    );
    fireEvent.change(screen.getByLabelText("问题"), {
      target: { value: "说句话" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() =>
      expect(container.querySelector("audio")).not.toBeNull(),
    );
    const audio = container.querySelector("audio");
    expect(audio).not.toBeNull();

    fireEvent.play(audio as HTMLAudioElement);
    expect(screen.getByText("正在说话…")).toBeInTheDocument();
    expect(
      container.querySelector(".conversation-avatar-speaking"),
    ).not.toBeNull();

    fireEvent.pause(audio as HTMLAudioElement);
    expect(screen.queryByText("正在说话…")).not.toBeInTheDocument();
  });

  it("restores saved conversation history on mount", async () => {
    vi.mocked(listConversationHistory).mockResolvedValue({
      messages: [
        {
          role: "user",
          content: "昨天问过",
          createdAt: "2026-08-01T09:00:00Z",
        },
        {
          role: "assistant",
          content: "昨天回答过",
          citations: ["[项目验收手册]"],
          citationUrls: ["https://feishu.cn/docx/doc-1"],
          grounded: true,
          createdAt: "2026-08-01T09:00:01Z",
        },
      ],
    });

    render(<Conversation />);

    await waitFor(() =>
      expect(screen.getByText("昨天问过")).toBeInTheDocument(),
    );
    expect(screen.getByText("昨天回答过")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "[项目验收手册]" }),
    ).toHaveAttribute("href", "https://feishu.cn/docx/doc-1");
  });

  it("copies an assistant reply to the clipboard", async () => {
    vi.mocked(postConversationReply).mockResolvedValue({
      text: "可复制的回答。",
      citations: [],
      grounded: false,
    });

    render(<Conversation />);
    fireEvent.change(screen.getByLabelText("问题"), {
      target: { value: "复制这个" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() =>
      expect(screen.getByText("可复制的回答。")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "复制" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "已复制" })).toBeInTheDocument(),
    );
    expect(clipboardWriteText).toHaveBeenCalledWith("可复制的回答。");
  });

  it("sends with Enter from the composer", async () => {
    vi.mocked(postConversationReply).mockResolvedValue({
      text: "回车发送成功。",
      citations: [],
      grounded: false,
    });

    render(<Conversation />);
    const composer = screen.getByLabelText("问题");
    fireEvent.change(composer, { target: { value: "回车" } });
    fireEvent.keyDown(composer, { key: "Enter" });

    await waitFor(() =>
      expect(screen.getByText("回车发送成功。")).toBeInTheDocument(),
    );
    expect(postConversationReply).toHaveBeenCalledTimes(1);
  });

  it("copies the full transcript", async () => {
    vi.mocked(postConversationReply).mockResolvedValue({
      text: "回答。",
      citations: [],
      grounded: false,
    });

    render(<Conversation />);
    fireEvent.change(screen.getByLabelText("问题"), {
      target: { value: "你好" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() =>
      expect(screen.getByText("回答。")).toBeInTheDocument(),
    );
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
});
