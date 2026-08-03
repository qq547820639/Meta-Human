import { renderHook, waitFor } from "@testing-library/react";
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
      id: "human-1",
      name: "我的数字人",
      status: "ready",
      portraitPath: "/tmp/portrait.jpg",
    });
    vi.mocked(fetchRecentConversation).mockResolvedValue({
      id: "conv-1",
      name: "昨天的对话",
    });
    vi.mocked(fetchResumableBuildJob).mockResolvedValue({
      id: "job-1",
      status: "building",
    });

    const { result } = renderHook(() => useRestoreState());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.defaultHuman?.status).toBe("ready");
    expect(result.current.recentConversation?.id).toBe("conv-1");
    expect(result.current.resumableJob?.id).toBe("job-1");
  });

  it("falls back to null when no state can be restored", async () => {
    vi.mocked(fetchDefaultHuman).mockResolvedValue(null);
    vi.mocked(fetchRecentConversation).mockResolvedValue(null);
    vi.mocked(fetchResumableBuildJob).mockResolvedValue(null);

    const { result } = renderHook(() => useRestoreState());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.defaultHuman).toBeNull();
    expect(result.current.recentConversation).toBeNull();
    expect(result.current.resumableJob).toBeNull();
  });
});