import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BuildJobData, BuildStageName } from "../../api/contracts";
import BuildRecoveryCard from "./BuildRecoveryCard";
import type { BuildJobSummary } from "./restoreClient";

vi.mock("../creation/avatarBuildClient", () => ({
  getBuildJob: vi.fn(),
  cancelBuildJob: vi.fn(),
  retryBuildJob: vi.fn(),
  cleanupBuildJob: vi.fn(),
}));

import {
  cancelBuildJob,
  cleanupBuildJob,
  getBuildJob,
  retryBuildJob,
} from "../creation/avatarBuildClient";

const runningJob: BuildJobSummary = {
  id: "job-1",
  status: "running",
  stage: "enroll_voice",
  stageProgress: "正在注册声音",
  succeededStages: ["validate_inputs"],
  retryCount: 0,
  errorCode: null,
  errorDetail: null,
  cancelled: false,
  updatedAt: "2026-08-04T12:00:00Z",
  createdAt: "2026-08-04T11:00:00Z",
  completedAt: null,
};

/**
 * The mocked client functions return the raw `BuildJobData` (snake_case)
 * contract shape; the component normalizes it to `BuildJobSummary` internally.
 */
const runningJobData: BuildJobData = {
  id: "job-1",
  status: "running",
  current_stage: "enroll_voice",
  stage_progress: "正在注册声音",
  succeeded_stages: ["validate_inputs"],
  retry_count: 0,
  error_code: null,
  error_detail: null,
  cancelled: false,
  digital_human_id: "human-1",
  created_at: "2026-08-04T11:00:00Z",
  updated_at: "2026-08-04T12:00:00Z",
  completed_at: null,
};

function jobData(overrides: Partial<BuildJobData>): BuildJobData {
  return { ...runningJobData, ...overrides };
}

function stageList(stages: BuildStageName[]): readonly BuildStageName[] {
  return stages;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("BuildRecoveryCard", () => {
  it("renders current stage, succeeded stages and updated time", () => {
    render(<BuildRecoveryCard job={runningJob} />);

    expect(
      screen.getByText("检测到未完成的形象构建"),
    ).toBeInTheDocument();
    expect(screen.getByText("注册声音")).toBeInTheDocument();
    expect(screen.getByText("校验素材")).toBeInTheDocument();
    expect(screen.getByText("正在注册声音")).toBeInTheDocument();
  });

  it("shows cancel for a running job and calls the cancel endpoint", async () => {
    vi.mocked(getBuildJob).mockResolvedValue(jobData({}));
    vi.mocked(cancelBuildJob).mockResolvedValue(
      jobData({ status: "cancelling" }),
    );

    render(<BuildRecoveryCard job={runningJob} />);
    fireEvent.click(screen.getByRole("button", { name: "取消任务" }));

    await waitFor(() =>
      expect(cancelBuildJob).toHaveBeenCalledWith("job-1"),
    );
  });

  it("shows retry and cleanup for a failed job", async () => {
    const failedJob: BuildJobSummary = {
      ...runningJob,
      status: "failed",
      errorCode: "provider_error",
      errorDetail: "远程服务不可用",
    };
    vi.mocked(getBuildJob).mockResolvedValue(
      jobData({
        status: "failed",
        error_code: "provider_error",
        error_detail: "远程服务不可用",
      }),
    );

    render(<BuildRecoveryCard job={failedJob} />);

    expect(
      screen.getByRole("button", { name: "重试" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "清理" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "查看错误详情" }),
    ).toBeInTheDocument();
  });

  it("reveals error detail when requested", async () => {
    const failedJob: BuildJobSummary = {
      ...runningJob,
      status: "failed",
      errorCode: "provider_error",
      errorDetail: "远程服务不可用",
    };
    vi.mocked(getBuildJob).mockResolvedValue(
      jobData({
        status: "failed",
        error_code: "provider_error",
        error_detail: "远程服务不可用",
      }),
    );

    render(<BuildRecoveryCard job={failedJob} />);
    fireEvent.click(
      screen.getByRole("button", { name: "查看错误详情" }),
    );

    expect(screen.getByText(/错误码：provider_error/)).toBeInTheDocument();
    expect(screen.getByText(/远程服务不可用/)).toBeInTheDocument();
  });

  it("calls onSettled when the polled job reaches a terminal state", async () => {
    const succeededJob: BuildJobSummary = {
      ...runningJob,
      status: "succeeded",
      stage: "save_result",
      succeededStages: [
        "validate_inputs",
        "enroll_voice",
        "enroll_avatar",
        "save_result",
      ],
    };
    vi.mocked(getBuildJob).mockResolvedValue(
      jobData({
        status: "succeeded",
        current_stage: "save_result",
        succeeded_stages: stageList([
          "validate_inputs",
          "enroll_voice",
          "enroll_avatar",
          "save_result",
        ]),
      }),
    );
    const onSettled = vi.fn();

    render(<BuildRecoveryCard job={runningJob} onSettled={onSettled} />);

    await waitFor(() => expect(onSettled).toHaveBeenCalledWith(succeededJob));
  });

  it("calls the cleanup endpoint for a cancelled job", async () => {
    const cancelledJob: BuildJobSummary = {
      ...runningJob,
      status: "cancelled",
      cancelled: true,
    };
    vi.mocked(getBuildJob).mockResolvedValue(
      jobData({ status: "cancelled", cancelled: true }),
    );
    vi.mocked(cleanupBuildJob).mockResolvedValue(
      jobData({ status: "cleanup_pending" }),
    );

    render(<BuildRecoveryCard job={cancelledJob} />);
    fireEvent.click(screen.getByRole("button", { name: "清理" }));

    await waitFor(() =>
      expect(cleanupBuildJob).toHaveBeenCalledWith("job-1"),
    );
  });
});