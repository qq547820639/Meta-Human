import { describe, expect, it } from "vitest";

import {
  needsConfirmation,
  severityOf,
  stateLabel,
} from "./uiStates";

describe("stateLabel", () => {
  it("labels every state in Chinese", () => {
    expect(stateLabel("loading")).toBe("载入中");
    expect(stateLabel("empty")).toBe("暂无内容");
    expect(stateLabel("error")).toBe("出错");
    expect(stateLabel("offline")).toBe("离线");
    expect(stateLabel("degraded")).toBe("功能受限");
  });
});

describe("severityOf", () => {
  it("treats a fatal flag and fatal codes as fatal", () => {
    expect(severityOf({ fatal: true })).toBe("fatal");
    expect(severityOf({ code: "readiness_failed_closed" })).toBe("fatal");
    expect(severityOf({ code: "fatal_crash" })).toBe("fatal");
  });

  it("treats offline / network errors as error", () => {
    expect(severityOf({ code: "offline" })).toBe("error");
    expect(severityOf({ code: "network" })).toBe("error");
  });

  it("treats 5xx and generic error codes as error", () => {
    expect(severityOf({ code: "http_500" })).toBe("error");
    expect(severityOf({ code: "provider_error" })).toBe("error");
  });

  it("treats quota / degraded / warning codes as warning", () => {
    expect(severityOf({ code: "quota_exceeded" })).toBe("warning");
    expect(severityOf({ code: "degraded" })).toBe("warning");
    expect(severityOf({ code: "warning_low_disk" })).toBe("warning");
  });

  it("defaults unclassified codes to info", () => {
    expect(severityOf({})).toBe("info");
    expect(severityOf({ code: "" })).toBe("info");
  });
});

describe("needsConfirmation", () => {
  it("always confirms irreversible actions", () => {
    expect(needsConfirmation("delete")).toBe(true);
    expect(needsConfirmation("reset")).toBe(true);
  });

  it("never confirms reversible actions", () => {
    expect(needsConfirmation("deploy")).toBe(false);
    expect(needsConfirmation("run")).toBe(false);
    expect(needsConfirmation("save")).toBe(false);
  });
});