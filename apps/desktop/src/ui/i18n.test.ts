import { describe, expect, it } from "vitest";

import { t, translate, type TranslationKey } from "./i18n";

describe("i18n zh-CN", () => {
  it("translates common actions", () => {
    expect(t("common.ok", "zh-CN")).toBe("确定");
    expect(t("common.cancel", "zh-CN")).toBe("取消");
    expect(t("common.retry", "zh-CN")).toBe("重试");
    expect(t("common.save", "zh-CN")).toBe("保存");
  });

  it("translates error and offline messages", () => {
    expect(t("error.generic", "zh-CN")).toBe("发生未知错误");
    expect(t("error.offline", "zh-CN")).toBe("当前处于离线状态");
    expect(t("network.offline", "zh-CN")).toBe("网络连接已断开");
  });

  it("translates streaming states", () => {
    expect(t("state.listening", "zh-CN")).toBe("正在聆听");
    expect(t("state.thinking", "zh-CN")).toBe("正在思考");
    expect(t("state.speaking", "zh-CN")).toBe("正在说话");
    expect(t("state.interrupted", "zh-CN")).toBe("对话已打断");
  });

  it("translates confirmations", () => {
    expect(t("confirm.delete", "zh-CN")).toBe("确定要删除吗？");
  });
});

describe("i18n en-US", () => {
  it("translates common actions", () => {
    expect(t("common.ok", "en-US")).toBe("OK");
    expect(t("common.cancel", "en-US")).toBe("Cancel");
    expect(t("common.retry", "en-US")).toBe("Retry");
    expect(t("common.save", "en-US")).toBe("Save");
  });

  it("translates error and offline messages", () => {
    expect(t("error.generic", "en-US")).toBe("An unknown error occurred");
    expect(t("network.offline", "en-US")).toBe("Network connection lost");
  });

  it("translates streaming states", () => {
    expect(t("state.listening", "en-US")).toBe("Listening");
    expect(t("state.thinking", "en-US")).toBe("Thinking");
    expect(t("state.speaking", "en-US")).toBe("Speaking");
    expect(t("state.interrupted", "en-US")).toBe("Interrupted");
  });
});

describe("param interpolation", () => {
  it("substitutes placeholders in both languages", () => {
    expect(translate("common.retryIn", "zh-CN", { seconds: 5 })).toBe(
      "将在 5 秒后重试",
    );
    expect(translate("common.retryIn", "en-US", { seconds: 5 })).toBe(
      "Retrying in 5 seconds",
    );
  });
});

describe("fallback", () => {
  it("falls back to the key for unknown keys", () => {
    expect(translate("nope.missing" as TranslationKey, "zh-CN")).toBe(
      "nope.missing",
    );
    expect(translate("nope.missing" as TranslationKey, "en-US")).toBe(
      "nope.missing",
    );
  });
});