import { describe, expect, it } from "vitest";

import {
  classifyModelType,
  validateModelCapability,
} from "./modelCapability";

describe("modelCapability", () => {
  it("classifies model ids by role", () => {
    expect(classifyModelType("llama3")).toBe("chat");
    expect(classifyModelType("nomic-embed-text")).toBe("embedding");
    expect(classifyModelType("bge-m3")).toBe("embedding");
    expect(classifyModelType("whisper-large-v3")).toBe("stt");
  });

  it("warns when a model clearly belongs to another role", () => {
    const issues = validateModelCapability({
      chatModel: "nomic-embed-text",
      embeddingModel: "llama3",
      sttModel: "",
    });
    expect(issues.some((issue) => issue.severity === "warning")).toBe(true);
    const chatIssue = issues.find((issue) => issue.role === "chat");
    expect(chatIssue?.message).toContain("嵌入");
  });

  it("errors when a configured model is absent from the live list", () => {
    const issues = validateModelCapability({
      chatModel: "missing-model",
      embeddingModel: "nomic-embed-text",
      sttModel: "",
      availableModels: ["llama3", "nomic-embed-text"],
    });
    const chatIssue = issues.find((issue) => issue.role === "chat");
    expect(chatIssue?.severity).toBe("error");
    expect(chatIssue?.message).toContain("不在本地服务的可用模型列表中");
  });

  it("stays silent when models match the live list", () => {
    const issues = validateModelCapability({
      chatModel: "llama3",
      embeddingModel: "nomic-embed-text",
      sttModel: "whisper",
      availableModels: ["llama3", "nomic-embed-text", "whisper"],
    });
    expect(issues).toEqual([]);
  });
});
