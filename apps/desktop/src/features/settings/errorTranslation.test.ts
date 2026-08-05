import { describe, expect, it } from "vitest";

import {
  ACTION_LABELS,
  classifyProbeErrorCode,
  translateErrorCode,
  translateHttpStatus,
  translateServiceError,
} from "./errorTranslation";

const ctx = { serviceLabel: "本地服务" };

describe("errorTranslation", () => {
  it("classifies connection refusals and timeouts", () => {
    expect(
      classifyProbeErrorCode(
        new Error("fetch failed", { cause: { code: "ECONNREFUSED" } }),
      ),
    ).toBe("connection_refused");
    expect(classifyProbeErrorCode(new Error("Failed to fetch"))).toBe(
      "connection_refused",
    );
    expect(classifyProbeErrorCode(new DOMException("Aborted", "AbortError"))).toBe(
      "timeout",
    );
    expect(classifyProbeErrorCode(new Error("timed out"))).toBe("timeout");
  });

  it("maps HTTP statuses to user actions", () => {
    expect(translateHttpStatus(401, ctx).code).toBe("http_401");
    expect(translateHttpStatus(401, ctx).actions).toContain("reauthorize");
    expect(translateHttpStatus(403, ctx).actions).toContain("open_permissions");
    expect(translateHttpStatus(404, ctx).actions).toContain("reselect_model");
    expect(translateHttpStatus(500, ctx).actions).toContain("retry");
  });

  it("translates probe error strings from the probe layer", () => {
    expect(translateServiceError("http_404", ctx).code).toBe("http_404");
    expect(translateServiceError("connection_refused", ctx).title).toContain(
      "无法连接",
    );
    expect(translateServiceError("unconfigured", ctx).title).toContain("配置");
    expect(translateServiceError("credentials_missing", ctx).actions).toContain(
      "reauthorize",
    );
  });

  it("translates model-not-found into a reselect action", () => {
    const translated = translateErrorCode("model_not_found", ctx);
    expect(translated.actions).toContain("reselect_model");
    expect(ACTION_LABELS.reselect_model).toBe("重新选择模型");
    expect(ACTION_LABELS.retry).toBe("重试");
  });

  it("falls back to an unknown-code message with a retry action", () => {
    const translated = translateErrorCode("weird_code", ctx);
    expect(translated.code).toBe("unknown");
    expect(translated.actions).toContain("retry");
  });
});
