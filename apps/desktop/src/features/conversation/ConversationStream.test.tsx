import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ConversationStream from "./ConversationStream";
import {
  Citation,
  ConversationStreamEvents,
  stopGenerating,
  streamConversationReply,
} from "./conversationClient";
import { getConversation } from "./conversationManagementClient";

vi.mock("./conversationClient", () => ({
  streamConversationReply: vi.fn(),
  stopGenerating: vi.fn(),
}));

vi.mock("./conversationManagementClient", () => ({
  getConversation: vi.fn(),
  listConversations: vi.fn(),
  searchConversations: vi.fn(),
  createConversation: vi.fn(),
  renameConversation: vi.fn(),
  archiveConversation: vi.fn(),
  unarchiveConversation: vi.fn(),
  deleteConversation: vi.fn(),
  clearConversationMessages: vi.fn(),
}));

vi.mock("./ConversationManagement", () => ({
  default: () => <div>对话管理</div>,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ConversationStream", () => {
  it("shows phased feedback and streams tokens into the reply", async () => {
    let events: ConversationStreamEvents = {};
    vi.mocked(streamConversationReply).mockImplementation(
      async ({ events: nextEvents }) => {
        events = nextEvents ?? {};
        await new Promise<void>(() => undefined);
      },
    );

    render(<ConversationStream />);
    fireEvent.change(screen.getByLabelText("问题"), {
      target: { value: "如何进入？" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("正在理解问题"),
    );

    act(() => events.onStage?.("retrieving"));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("正在检索知识"),
    );

    act(() => events.onFoundSources?.(3));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("找到 3 个相关来源"),
    );

    act(() => events.onToken?.("你好"));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("正在生成回答"),
    );
    expect(screen.getByText("你好")).toBeInTheDocument();

    act(() => events.onToken?.("世界。"));
    expect(screen.getByText("你好世界。")).toBeInTheDocument();

    act(() => events.onDone?.("你好世界。"));
    await waitFor(() =>
      expect(screen.getByText("你好世界。")).toBeInTheDocument(),
    );
  });

  it("renders citations for a grounded reply", async () => {
    let events: ConversationStreamEvents = {};
    vi.mocked(streamConversationReply).mockImplementation(
      async ({ events: nextEvents }) => {
        events = nextEvents ?? {};
      },
    );

    render(<ConversationStream />);
    fireEvent.change(screen.getByLabelText("问题"), {
      target: { value: "引用问题" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    events.onCitations?.(
      [
        {
          id: "src-1",
          title: "项目验收手册",
          type: "doc",
          url: "https://feishu.cn/docx/doc-1",
        },
      ],
      true,
    );
    events.onToken?.("引用回答。");
    events.onDone?.("引用回答。");

    await waitFor(() =>
      expect(
        screen.getByRole("link", { name: "项目验收手册" }),
      ).toHaveAttribute("href", "https://feishu.cn/docx/doc-1"),
    );
  });

  it("shows an error and keeps the input recoverable", async () => {
    let events: {
      onError?: (message: string, retryable: boolean) => void;
    } = {};
    vi.mocked(streamConversationReply).mockImplementation(
      async ({ events: nextEvents }) => {
        events = nextEvents ?? {};
      },
    );

    render(<ConversationStream />);
    fireEvent.change(screen.getByLabelText("问题"), {
      target: { value: "你好" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    events.onError?.("对话服务暂时无法回复。", true);

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "对话服务暂时无法回复。",
      ),
    );
    expect(screen.getByLabelText("问题")).toHaveValue("你好");
  });

  it("stops a generation through the stop endpoint", async () => {
    let events: {
      onToken?: (text: string) => void;
    } = {};
    vi.mocked(streamConversationReply).mockImplementation(
      async ({ events: nextEvents }) => {
        events = nextEvents ?? {};
      },
    );
    vi.mocked(stopGenerating).mockResolvedValue(undefined);

    render(<ConversationStream />);
    fireEvent.change(screen.getByLabelText("问题"), {
      target: { value: "慢慢说" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    events.onToken?.("部分。");

    fireEvent.click(screen.getByRole("button", { name: "停止生成" }));
    expect(stopGenerating).toHaveBeenCalledTimes(1);
  });

  it("loads a selected conversation through the management client", async () => {
    vi.mocked(getConversation).mockResolvedValue({
      id: "conv-1",
      name: "昨天的对话",
      messages: [
        { role: "user", content: "昨天问过" },
        { role: "assistant", content: "昨天回答过", grounded: true },
      ],
    });
    vi.mocked(streamConversationReply).mockResolvedValue(undefined);

    render(<ConversationStream portraitPath="/tmp/portrait.jpg" />);

    expect(screen.getByText("对话管理")).toBeInTheDocument();
    expect(screen.getByAltText("你的数字人人像")).toHaveAttribute(
      "src",
      "/tmp/portrait.jpg",
    );
  });
});