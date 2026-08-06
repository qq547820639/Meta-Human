import { describe, expect, it } from "vitest";

import {
  desensitize,
  isExpired,
  resolveEffectiveScope,
  sensitivityLevel,
  shouldPersistToLongTerm,
} from "./memoryPolicy";

describe("resolveEffectiveScope", () => {
  it("resolves each scope to itself", () => {
    expect(resolveEffectiveScope("avatar")).toBe("avatar");
    expect(resolveEffectiveScope("session")).toBe("session");
    expect(resolveEffectiveScope("user")).toBe("user");
  });
});

describe("isExpired", () => {
  it("never expires without an expiry", () => {
    expect(isExpired({ storedAtMs: 0, expiryMs: null, nowMs: 1_000_000 })).toBe(false);
  });

  it("is expired when now has passed storedAt + expiryMs", () => {
    expect(isExpired({ storedAtMs: 1_000, expiryMs: 500, nowMs: 1_501 })).toBe(true);
  });

  it("is not expired before the deadline", () => {
    expect(isExpired({ storedAtMs: 1_000, expiryMs: 500, nowMs: 1_499 })).toBe(false);
  });

  it("expires immediately for a non-positive expiry", () => {
    expect(isExpired({ storedAtMs: 1_000, expiryMs: 0, nowMs: 1_000 })).toBe(true);
  });
});

describe("sensitivityLevel", () => {
  it("flags content with a phone number as high", () => {
    expect(sensitivityLevel("请联系我 13800138000")).toBe("high");
  });

  it("flags content with an email as high", () => {
    expect(sensitivityLevel("邮箱是 jack@example.com")).toBe("high");
  });

  it("flags content mentioning an address category as medium", () => {
    expect(sensitivityLevel("我的家庭住址在东城区")).toBe("medium");
  });

  it("flags ordinary content as low", () => {
    expect(sensitivityLevel("我喜欢喝咖啡")).toBe("low");
  });
});

describe("desensitize", () => {
  it("replaces a phone number with a placeholder", () => {
    expect(desensitize("电话 13800138000 谢谢")).toBe("电话 [电话] 谢谢");
  });

  it("replaces an email with a placeholder", () => {
    expect(desensitize("联系 jack@example.com")).toBe("联系 [邮箱]");
  });

  it("replaces an ID card number with a placeholder", () => {
    expect(desensitize("身份 110101199003077777")).toBe("身份 [身份证]");
  });

  it("leaves non-sensitive content unchanged", () => {
    expect(desensitize("我喜欢喝咖啡")).toBe("我喜欢喝咖啡");
  });
});

describe("shouldPersistToLongTerm", () => {
  it("never persists temporary-session memory", () => {
    expect(
      shouldPersistToLongTerm({ scope: "session", expired: false, tempSession: true }),
    ).toBe(false);
  });

  it("never persists expired memory", () => {
    expect(
      shouldPersistToLongTerm({ scope: "user", expired: true, tempSession: false }),
    ).toBe(false);
  });

  it("persists a valid, non-temp, non-expired memory", () => {
    expect(
      shouldPersistToLongTerm({ scope: "user", expired: false, tempSession: false }),
    ).toBe(true);
  });
});