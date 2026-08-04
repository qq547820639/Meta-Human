import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useRestoreState } from "./useRestoreState";
import {
  fetchDefaultHuman,
  fetchRecentConversation,
  fetchResumableBuildJob,
} from "./restoreClient";

vi.mock("./restoreClient", () => ({
  fetchDefaultHuman: vi.fn(),
  fetchRecentConversation: vi.fn(),
  fetchResumableBuildJob: vi.fn(),
}));

describe("useRestoreState", () => {
  it("restores a ready human, recent conversation and build job", async () => {
    vi.mocked(fetchDefaultHuman).mockResolvedValue({
      ok: true,
      data: {
        id: "human-1",
        name: "我的数字人",
        status: "ready",
        portraitPath: "/tmp/portrait.jpg",
      },
    });
    vi.mocked(fetchRecentConversation).mockResolvedValue({
      ok: true,
      data: { id: "conv-1", name: "昨天的对话" },
    });
    vi.mocked(fetchResumableBuildJob).mockResolvedValue({
      ok: true,
      data: {
        id: "job-1",
        status: "running",
        stage: "enroll_voice",
        succeededStages: ["validate_inputs"],
        cancelled: false,
      },
    });

    const { result } = renderHook(() => useRestoreState());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.status).toBe("success");
    expect(result.current.defaultHuman?.status).toBe("ready");
    expect(result.current.recentConversation?.id).toBe("conv-1");
    expect(result.current.resumableJob?.id).toBe("job-1");
    expect(result.current.resumableJob?.stage).toBe("enroll_voice");
    expect(result.current.resumableJob?.succeededStages).toEqual([
      "validate_inputs",
    ]);
  });

  it("reports empty when every fetch succeeds but there is no data", async () => {
    vi.mocked(fetchDefaultHuman).mockResolvedValue({ ok: true, data: null });
    vi.mocked(fetchRecentConversation).mockResolvedValue({ ok: true, data: null });
    vi.mocked(fetchResumableBuildJob).mockResolvedValue({ ok: true, data: null });

    const { result } = renderHook(() => useRestoreState());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.status).toBe("empty");
    expect(result.current.errorKind).toBeUndefined();
    expect(result.current.defaultHuman).toBeNull();
    expect(result.current.recentConversation).toBeNull();
    expect(result.current.resumableJob).toBeNull();
  });

  it("reports error (not empty) when a fetch fails", async () => {
    vi.mocked(fetchDefaultHuman).mockResolvedValue({
      ok: false,
      error: "sidecar_unreachable",
    });
    vi.mocked(fetchRecentConversation).mockResolvedValue({ ok: true, data: null });
    vi.mocked(fetchResumableBuildJob).mockResolvedValue({ ok: true, data: null });

    const { result } = renderHook(() => useRestoreState());

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.errorKind).toBe("sidecar_unreachable");
    expect(result.current.defaultHuman).toBeNull();
  });

  it("reports error when the build job fetch fails", async () => {
    vi.mocked(fetchDefaultHuman).mockResolvedValue({ ok: true, data: null });
    vi.mocked(fetchRecentConversation).mockResolvedValue({ ok: true, data: null });
    vi.mocked(fetchResumableBuildJob).mockResolvedValue({
      ok: false,
      error: "database_error",
    });

    const { result } = renderHook(() => useRestoreState());

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.errorKind).toBe("database_error");
  });

  it("retries and recovers after a failure", async () => {
    vi.mocked(fetchDefaultHuman).mockResolvedValueOnce({
      ok: false,
      error: "auth_failed",
    });
    vi.mocked(fetchRecentConversation).mockResolvedValue({ ok: true, data: null });
    vi.mocked(fetchResumableBuildJob).mockResolvedValue({ ok: true, data: null });

    const { result } = renderHook(() => useRestoreState());

    await waitFor(() => expect(result.current.status).toBe("error"));

    vi.mocked(fetchDefaultHuman).mockResolvedValue({
      ok: true,
      data: { id: "human-1", name: "我的数字人", status: "ready" },
    });
    act(() => result.current.retry());

    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(result.current.defaultHuman?.id).toBe("human-1");
  });
});