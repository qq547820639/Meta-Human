import { describe, expect, it } from "vitest";

import {
  isInternalStackTrace,
  sanitizeErrorForUI,
  userErrorMessage,
} from "./safeErrors";

const STACK = [
  "Error: boom",
  "    at fn (file:///Users/x/app/src/ui/a.ts:10:5)",
  "    at Object.call (node_modules/lib.js:3:1)",
].join("\n");

describe("isInternalStackTrace", () => {
  it("detects a raw stack trace", () => {
    expect(isInternalStackTrace(STACK)).toBe(true);
  });

  it("detects a message carrying an error signature and a file path", () => {
    expect(
      isInternalStackTrace("Error: failed at /src/app.tsx:12:1"),
    ).toBe(true);
  });

  it("rejects a plain user-facing message", () => {
    expect(isInternalStackTrace("今日额度已用完。")).toBe(false);
  });

  it("rejects empty input", () => {
    expect(isInternalStackTrace("")).toBe(false);
  });
});

describe("userErrorMessage", () => {
  it("returns a safe message without stack frames", () => {
    const message = userErrorMessage(new Error(STACK));
    expect(message).toContain("boom");
    expect(message).not.toContain("at ");
    expect(message).not.toContain("node_modules");
  });

  it("prefixes an optional error code", () => {
    expect(userErrorMessage(new Error("quota"), { code: "quota_exceeded" })).toBe(
      "[quota_exceeded] quota",
    );
  });

  it("handles non-Error thrown values", () => {
    expect(userErrorMessage("plain string")).toBe("plain string");
  });
});

describe("sanitizeErrorForUI", () => {
  it("scrubs stack frames and marks the output safe", () => {
    const result = sanitizeErrorForUI(new Error(STACK));
    expect(result.safe).toBe(true);
    expect(result.message).toContain("boom");
    expect(result.message).not.toContain("at ");
    expect(result.message).not.toContain("node_modules");
    expect(result.message).not.toMatch(/:\d+:\d+/);
  });

  it("extracts a stable error code when present", () => {
    const err = new Error("quota exceeded");
    (err as { code?: string }).code = "quota_exceeded";
    expect(sanitizeErrorForUI(err).code).toBe("quota_exceeded");
  });

  it("falls back to a generic message for empty errors", () => {
    expect(sanitizeErrorForUI({}).message).toBe("发生未知错误");
    expect(sanitizeErrorForUI({}).code).toBeNull();
  });
});