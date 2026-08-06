import { describe, expect, it } from "vitest";

import { evaluateFirstSuccess } from "./firstSuccess";

describe("firstSuccess", () => {
  it("passes when the reply is audible, meaningful and error-free", () => {
    const result = evaluateFirstSuccess({
      audibleReply: true,
      hadError: false,
      meaningful: true,
    });
    expect(result.passed).toBe(true);
    expect(result.reason.trim().length).toBeGreaterThan(0);
  });

  it("fails when the reply is silent", () => {
    const result = evaluateFirstSuccess({
      audibleReply: false,
      hadError: false,
      meaningful: true,
    });
    expect(result.passed).toBe(false);
    expect(result.reason.trim().length).toBeGreaterThan(0);
  });

  it("fails when a blocking error occurred", () => {
    const result = evaluateFirstSuccess({
      audibleReply: true,
      hadError: true,
      meaningful: true,
    });
    expect(result.passed).toBe(false);
    expect(result.reason.trim().length).toBeGreaterThan(0);
  });

  it("fails when the reply is not meaningful", () => {
    const result = evaluateFirstSuccess({
      audibleReply: true,
      hadError: false,
      meaningful: false,
    });
    expect(result.passed).toBe(false);
    expect(result.reason.trim().length).toBeGreaterThan(0);
  });

  it("fails when several conditions are missing at once", () => {
    const result = evaluateFirstSuccess({
      audibleReply: false,
      hadError: true,
      meaningful: false,
    });
    expect(result.passed).toBe(false);
  });
});