import { describe, expect, it } from "vitest";

import {
  accept,
  createCorrectionStatus,
  proposeCorrection,
  reject,
  reset,
} from "./citationCorrection";

describe("citation correction state machine", () => {
  it("proposes a correction from the none state", () => {
    const status = proposeCorrection(createCorrectionStatus(), "原文", "修正");
    expect(status).toEqual({ original: "原文", corrected: "修正", state: "proposed" });
  });

  it("cannot accept before proposing", () => {
    const status = accept(createCorrectionStatus());
    expect(status.state).toBe("none");
    expect(status.corrected).toBeNull();
  });

  it("cannot reject before proposing", () => {
    const status = reject(createCorrectionStatus());
    expect(status.state).toBe("none");
  });

  it("accepts a proposed correction", () => {
    const proposed = proposeCorrection(createCorrectionStatus(), "a", "b");
    const accepted = accept(proposed);
    expect(accepted.state).toBe("accepted");
    expect(accepted.corrected).toBe("b");
  });

  it("rejects a proposed correction", () => {
    const proposed = proposeCorrection(createCorrectionStatus(), "a", "b");
    const rejected = reject(proposed);
    expect(rejected.state).toBe("rejected");
  });

  it("re-proposes from a rejected state", () => {
    const proposed = proposeCorrection(createCorrectionStatus(), "a", "b");
    const rejected = reject(proposed);
    const reProposed = proposeCorrection(rejected, "a", "c");
    expect(reProposed.state).toBe("proposed");
    expect(reProposed.corrected).toBe("c");
  });

  it("cannot re-propose once accepted", () => {
    const accepted = accept(proposeCorrection(createCorrectionStatus(), "a", "b"));
    const again = proposeCorrection(accepted, "a", "c");
    expect(again.state).toBe("accepted");
    expect(again.corrected).toBe("b");
  });

  it("resets to the initial state", () => {
    const accepted = accept(proposeCorrection(createCorrectionStatus(), "a", "b"));
    expect(reset(accepted)).toEqual({ original: null, corrected: null, state: "none" });
  });
});