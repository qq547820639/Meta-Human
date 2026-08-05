import { describe, expect, it } from "vitest";

import {
  downloadProgress,
  initialUpdateState,
  isRetryable,
  isUpdateActive,
  updateReducer,
  updateStatusLabel,
  type UpdateUiState,
} from "./updateStateMachine";

function apply(
  state: UpdateUiState,
  ...actions: Parameters<typeof updateReducer>[1][]
): UpdateUiState {
  return actions.reduce(
    (acc, action) => updateReducer(acc, action),
    state,
  );
}

const configured = apply(initialUpdateState, {
  type: "INIT_CONFIG",
  currentVersion: "0.1.0",
  channel: "stable",
});

describe("updateReducer – signed update lifecycle", () => {
  it("moves idle -> checking -> available -> downloading -> verifying_signature -> ready -> installing -> idle", () => {
    const state = apply(
      configured,
      { type: "CHECK_START" },
      { type: "CHECK_OK", availableVersion: "0.2.0" },
      { type: "DOWNLOAD_START" },
      { type: "DOWNLOAD_PROGRESS", downloadedBytes: 50, totalBytes: 100 },
      { type: "DOWNLOAD_PROGRESS", downloadedBytes: 100, totalBytes: 100 },
      { type: "DOWNLOAD_COMPLETE" },
      { type: "SIGNATURE_OK" },
      { type: "BACKUP_MADE" },
      { type: "INSTALL_START" },
      { type: "INSTALL_DONE" },
    );
    expect(state.phase).toBe("idle");
    expect(state.availableVersion).toBeNull();
    expect(state.signatureVerified).toBe(false);
    expect(state.currentVersion).toBe("0.1.0");
  });

  it("rejects INSTALL_START before the signature is verified", () => {
    const state = apply(
      configured,
      { type: "CHECK_START" },
      { type: "CHECK_OK", availableVersion: "0.2.0" },
      { type: "DOWNLOAD_START" },
      { type: "DOWNLOAD_PROGRESS", downloadedBytes: 100, totalBytes: 100 },
      { type: "DOWNLOAD_COMPLETE" },
      // No SIGNATURE_OK yet.
      { type: "INSTALL_START" },
    );
    // Still verifying/ready-ish; install did NOT begin.
    expect(state.phase).not.toBe("installing");
    expect(state.phase).toBe("verifying_signature");
  });

  it("rejects DOWNLOAD_COMPLETE when no progress was made", () => {
    const onlyStarted = apply(
      configured,
      { type: "CHECK_START" },
      { type: "CHECK_OK", availableVersion: "0.2.0" },
      { type: "DOWNLOAD_START" },
      { type: "DOWNLOAD_COMPLETE" },
    );
    expect(onlyStarted.phase).toBe("downloading");
  });

  it("a tampered signature lands in error and never in ready", () => {
    const state = apply(
      configured,
      { type: "CHECK_START" },
      { type: "CHECK_OK", availableVersion: "0.2.0" },
      { type: "DOWNLOAD_START" },
      { type: "DOWNLOAD_PROGRESS", downloadedBytes: 100, totalBytes: 100 },
      { type: "DOWNLOAD_COMPLETE" },
      { type: "SIGNATURE_INVALID", message: "签名校验失败" },
    );
    expect(state.phase).toBe("error");
    expect(state.error?.kind).toBe("signature_invalid");
    expect(state.signatureVerified).toBe(false);
    // Signature failures are NOT retryable.
    expect(isRetryable(state.error)).toBe(false);
  });

  it("a download failure is retryable and RETRY re-enters checking with attempt+1", () => {
    let state = apply(
      configured,
      { type: "CHECK_START" },
      { type: "CHECK_OK", availableVersion: "0.2.0" },
      { type: "DOWNLOAD_START" },
      { type: "DOWNLOAD_FAIL", message: "网络中断" },
    );
    expect(state.phase).toBe("error");
    expect(state.error?.kind).toBe("download_failed");
    expect(isRetryable(state.error)).toBe(true);

    state = apply(state, { type: "RETRY" });
    expect(state.phase).toBe("checking");
    expect(state.attempt).toBe(1);
    expect(state.error).toBeNull();
  });

  it("an install failure can be rolled back to rolled_back", () => {
    const state = apply(
      configured,
      { type: "CHECK_START" },
      { type: "CHECK_OK", availableVersion: "0.2.0" },
      { type: "DOWNLOAD_START" },
      { type: "DOWNLOAD_PROGRESS", downloadedBytes: 100, totalBytes: 100 },
      { type: "DOWNLOAD_COMPLETE" },
      { type: "SIGNATURE_OK" },
      { type: "INSTALL_START" },
      { type: "INSTALL_FAIL", message: "安装失败" },
      { type: "ROLLED_BACK" },
    );
    expect(state.phase).toBe("rolled_back");
  });

  it("supports switching between stable and beta channels when idle", () => {
    let state = apply(configured, { type: "SET_CHANNEL", channel: "beta" });
    expect(state.channel).toBe("beta");
    state = apply(state, { type: "SET_CHANNEL", channel: "stable" });
    expect(state.channel).toBe("stable");
  });

  it("rejects a channel switch while a download is in flight", () => {
    const inFlight = apply(
      configured,
      { type: "CHECK_START" },
      { type: "CHECK_OK", availableVersion: "0.2.0" },
      { type: "DOWNLOAD_START" },
    );
    const switched = apply(inFlight, { type: "SET_CHANNEL", channel: "beta" });
    expect(switched.channel).toBe("stable");
  });

  it("CHECK_OK only from checking; CHECK_START only from idle/error/rolled_back", () => {
    // CHECK_OK from idle is illegal.
    expect(apply(configured, { type: "CHECK_OK", availableVersion: "9.9.9" }).phase).toBe("idle");
    // CHECK_START while already checking is illegal.
    const checking = apply(configured, { type: "CHECK_START" });
    expect(checking.phase).toBe("checking");
    const again = apply(checking, { type: "CHECK_START" });
    expect(again.phase).toBe("checking");
  });

  it("CHECK_NONE from checking returns to idle as up-to-date", () => {
    const state = apply(
      configured,
      { type: "CHECK_START" },
      { type: "CHECK_NONE" },
    );
    expect(state.phase).toBe("idle");
    expect(state.availableVersion).toBeNull();
    expect(updateStatusLabel(state)).toBe("已是最新版本");
  });

  it("CHECK_NONE outside checking is illegal", () => {
    expect(apply(configured, { type: "CHECK_NONE" }).phase).toBe("idle");
  });

  it("RESET returns to idle preserving version and channel", () => {
    const busy = apply(
      configured,
      { type: "SET_CHANNEL", channel: "beta" },
      { type: "CHECK_START" },
      { type: "CHECK_OK", availableVersion: "0.2.0" },
      { type: "DOWNLOAD_START" },
    );
    const reset = apply(busy, { type: "RESET" });
    expect(reset.phase).toBe("idle");
    expect(reset.currentVersion).toBe("0.1.0");
    expect(reset.channel).toBe("beta");
  });

  it("not_configured is surfaced as a retryable error label", () => {
    const state = apply(configured, {
      type: "CHECK_START",
    }, {
      type: "CHECK_FAIL",
      kind: "not_configured",
      message: "未配置更新端点与签名公钥",
    });
    expect(state.phase).toBe("error");
    expect(isRetryable(state.error)).toBe(true);
    expect(updateStatusLabel(state)).toContain("未配置更新端点与签名公钥");
  });

  it("derives progress and active flags", () => {
    const downloading = apply(
      configured,
      { type: "CHECK_START" },
      { type: "CHECK_OK", availableVersion: "0.2.0" },
      { type: "DOWNLOAD_START" },
      { type: "DOWNLOAD_PROGRESS", downloadedBytes: 25, totalBytes: 100 },
    );
    expect(downloadProgress(downloading)).toBeCloseTo(0.25);
    expect(isUpdateActive(downloading)).toBe(true);
    expect(updateStatusLabel(downloading)).toBe("正在下载更新… 25%");
    expect(isUpdateActive(configured)).toBe(false);
  });
});