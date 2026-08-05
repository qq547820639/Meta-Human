import { describe, expect, it } from "vitest";

import {
  buildJsonExport,
  buildMarkdownExport,
  exportFileName,
  type ConversationExportData,
} from "./conversationExport";

const data: ConversationExportData = {
  conversationName: "我的第一次对话",
  exportedAt: "2026-08-05T10:00:00.000Z",
  digitalHuman: "小助手",
  model: "voxstudio-chat-1",
  appVersion: "0.1.0",
  messages: [
    {
      role: "user",
      text: "你好",
      createdAt: "2026-08-05T09:59:00.000Z",
    },
    {
      role: "assistant",
      text: "你好，有什么可以帮你？",
      createdAt: "2026-08-05T10:00:00.000Z",
      citations: ["项目验收手册"],
      grounded: true,
    },
  ],
};

describe("conversation export builders", () => {
  it("builds a Markdown export containing session name, time, digital human, model, version, messages and citations", () => {
    const md = buildMarkdownExport(data);
    expect(md).toContain("# 我的第一次对话");
    expect(md).toContain("数字人：小助手");
    expect(md).toContain("模型：voxstudio-chat-1");
    expect(md).toContain("版本：0.1.0");
    expect(md).toContain("你好，有什么可以帮你？");
    expect(md).toContain("来源：[项目验收手册]");
  });

  it("builds a JSON export containing session name, time, digital human, model, version, messages and citations", () => {
    const json = buildJsonExport(data);
    const parsed = JSON.parse(json);
    expect(parsed.conversation.name).toBe("我的第一次对话");
    expect(parsed.conversation.digitalHuman).toBe("小助手");
    expect(parsed.conversation.model).toBe("voxstudio-chat-1");
    expect(parsed.conversation.appVersion).toBe("0.1.0");
    expect(parsed.exportedAt).toBe("2026-08-05T10:00:00.000Z");
    expect(parsed.messages).toHaveLength(2);
    expect(parsed.messages[0].text).toBe("你好");
    expect(parsed.messages[1].citations).toEqual(["项目验收手册"]);
    expect(parsed.messages[1].grounded).toBe(true);
  });

  it("derives a safe export filename from the conversation name and format", () => {
    expect(exportFileName("我的对话", "markdown")).toBe("我的对话.md");
    expect(exportFileName("我的对话", "json")).toBe("我的对话.json");
    expect(exportFileName("a/b:c*?", "markdown")).not.toMatch(/[\\/:*?"<>|]/);
  });
});