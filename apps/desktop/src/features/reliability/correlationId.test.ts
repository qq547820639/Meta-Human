import { describe, expect, it } from "vitest";

import {
  isValidCorrelationId,
  newCorrelationId,
  withCorrelation,
} from "./correlationId";

describe("newCorrelationId", () => {
  it("generates a valid 16-hex-char id", () => {
    const id = newCorrelationId();
    expect(id).toMatch(/^[0-9a-f]{16}$/);
  });

  it("generates distinct ids across calls", () => {
    const ids = new Set(Array.from({ length: 200 }, () => newCorrelationId()));
    expect(ids.size).toBe(200);
  });
});

describe("withCorrelation", () => {
  it("returns an envelope with the given scope and a fresh id", () => {
    const env = withCorrelation("send");
    expect(env.scope).toBe("send");
    expect(isValidCorrelationId(env.correlationId)).toBe(true);
  });

  it("reuses a provided id instead of minting a new one", () => {
    const id = newCorrelationId();
    const env = withCorrelation("restore", id);
    expect(env.correlationId).toBe(id);
    expect(env.scope).toBe("restore");
  });
});

describe("isValidCorrelationId", () => {
  it("accepts a well-formed id", () => {
    expect(isValidCorrelationId("0123456789abcdef")).toBe(true);
  });

  it("rejects malformed ids", () => {
    expect(isValidCorrelationId("")).toBe(false);
    expect(isValidCorrelationId("abc")).toBe(false);
    expect(isValidCorrelationId("0123456789abcdeG")).toBe(false);
    expect(isValidCorrelationId("0123456789ABCDEF")).toBe(false);
    expect(isValidCorrelationId("0123456789abcdef0")).toBe(false);
  });
});