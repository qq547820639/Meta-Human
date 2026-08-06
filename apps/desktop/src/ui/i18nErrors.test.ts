import { describe, expect, it } from "vitest";

import { localizeError, stripTechnicalDetails } from "./i18nErrors";

describe("localizeError", () => {
  it("localizes a known code in Chinese", () => {
    expect(localizeError("offline", "zh-CN")).toBe(
      "[offline] 当前处于离线状态",
    );
    expect(localizeError("network", "zh-CN")).toBe(
      "[network] 网络连接已断开",
    );
  });

  it("localizes a known code in English", () => {
    expect(localizeError("offline", "en-US")).toBe(
      "[offline] You are currently offline",
    );
  });

  it("falls back to a generic message for unknown codes", () => {
    expect(localizeError("weird_code", "zh-CN")).toBe(
      "[weird_code] 发生未知错误",
    );
    expect(localizeError("weird_code", "en-US")).toBe(
      "[weird_code] An unknown error occurred",
    );
  });
});

describe("stripTechnicalDetails", () => {
  const stack = [
    "请求失败: FooError: something broke",
    "    at fn (file:///Users/x/app/src/ui/a.ts:10:5)",
    "    at call (node_modules/lib.js:3:1)",
  ].join("\n");

  it("removes stack frames and file paths", () => {
    const clean = stripTechnicalDetails(stack);
    expect(clean).toContain("something broke");
    expect(clean).not.toContain("at fn");
    expect(clean).not.toContain("node_modules");
    expect(clean).not.toMatch(/:\d+:\d+/);
  });

  it("leaves plain messages unchanged", () => {
    expect(stripTechnicalDetails("今日额度已用完。")).toBe("今日额度已用完。");
  });
});