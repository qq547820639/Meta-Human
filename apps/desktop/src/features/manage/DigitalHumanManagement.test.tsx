import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../api/client";
import type { BuildJobData, DigitalHumanData } from "../../api/contracts";
import DigitalHumanManagement, {
  deleteDigitalHumanWithCleanup,
} from "./DigitalHumanManagement";
import {
  cleanupBuildJob,
  deleteHuman,
  getRecentBuildJob,
  listHumans,
  renameHuman,
  retryBuildJob,
  setDefaultHuman,
} from "../creation/avatarBuildClient";

vi.mock("../creation/avatarBuildClient", () => ({
  listHumans: vi.fn(),
  getRecentBuildJob: vi.fn(),
  setDefaultHuman: vi.fn(),
  renameHuman: vi.fn(),
  deleteHuman: vi.fn(),
  retryBuildJob: vi.fn(),
  cleanupBuildJob: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  vi.mocked(getRecentBuildJob).mockResolvedValue(null);
});

function human(overrides: Partial<DigitalHumanData> = {}): DigitalHumanData {
  return {
    id: "human-1",
    name: "阿明",
    voice_provider_id: null,
    avatar_provider_id: null,
    voice_id: null,
    avatar_id: null,
    creation_status: "ready",
    creation_progress: null,
    is_default: true,
    error: null,
    portrait_path: null,
    recording_path: null,
    remote_status: null,
    created_at: "2026-08-04T00:00:00Z",
    updated_at: "2026-08-04T00:00:00Z",
    ...overrides,
  };
}

function job(overrides: Partial<BuildJobData> = {}): BuildJobData {
  return {
    id: "job-1",
    status: "succeeded",
    current_stage: "save_result",
    stage_progress: null,
    succeeded_stages: ["validate_inputs", "enroll_voice", "enroll_avatar"],
    retry_count: 0,
    error_code: null,
    error_detail: null,
    cancelled: false,
    digital_human_id: "human-1",
    created_at: "2026-08-04T00:00:00Z",
    updated_at: "2026-08-04T00:00:00Z",
    completed_at: "2026-08-04T00:01:00Z",
    ...overrides,
  };
}

function apiError(message: string, status = 500): ApiError {
  return new ApiError(
    {
      code: "avatar_list_failed",
      message,
      retryable: true,
      request_id: "req-1",
    },
    status,
  );
}

describe("DigitalHumanManagement", () => {
  it("renders the digital human list with default marker and statuses", async () => {
    vi.mocked(listHumans).mockResolvedValue([
      human({ id: "human-1", name: "阿明", is_default: true }),
      human({
        id: "human-2",
        name: "小美",
        is_default: false,
        creation_status: "failed",
        error: "voice enroll failed",
        remote_status: "uploaded",
      }),
    ]);

    render(<DigitalHumanManagement />);

    await waitFor(() =>
      expect(screen.getByText("阿明")).toBeInTheDocument(),
    );
    expect(screen.getByText("小美")).toBeInTheDocument();
    expect(screen.getByText("（默认）")).toBeInTheDocument();
    expect(screen.getByText("创建状态：失败")).toBeInTheDocument();
    expect(screen.getByText("失败原因：voice enroll failed")).toBeInTheDocument();
    expect(screen.getByText("远程状态：uploaded")).toBeInTheDocument();
  });

  it("switches the default digital human and notifies the parent", async () => {
    vi.mocked(listHumans).mockResolvedValue([
      human({ id: "human-1", name: "阿明", is_default: true }),
      human({ id: "human-2", name: "小美", is_default: false }),
    ]);
    vi.mocked(setDefaultHuman).mockResolvedValue(
      human({ id: "human-2", name: "小美", is_default: true }),
    );
    const onSelectHuman = vi.fn();

    render(<DigitalHumanManagement onSelectHuman={onSelectHuman} />);

    await waitFor(() =>
      expect(screen.getByText("阿明")).toBeInTheDocument(),
    );

    const second = screen
      .getByText("小美")
      .closest("li") as HTMLElement;
    fireEvent.click(within(second).getByRole("button", { name: "设为默认" }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "已设为默认数字人：小美",
      ),
    );
    expect(setDefaultHuman).toHaveBeenCalledWith("human-2");
    expect(onSelectHuman).toHaveBeenCalledWith("human-2");
  });

  it("renames a digital human", async () => {
    vi.mocked(listHumans).mockResolvedValue([
      human({ id: "human-1", name: "阿明" }),
    ]);
    vi.mocked(renameHuman).mockResolvedValue(
      human({ id: "human-1", name: "阿明（新）" }),
    );

    render(<DigitalHumanManagement />);

    await waitFor(() =>
      expect(screen.getByText("阿明")).toBeInTheDocument(),
    );

    const row = screen.getByText("阿明").closest("li") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "改名" }));
    const input = within(row).getByLabelText("新名称");
    fireEvent.change(input, { target: { value: "阿明（新）" } });
    fireEvent.click(within(row).getByRole("button", { name: "保存名称" }));

    await waitFor(() =>
      expect(renameHuman).toHaveBeenCalledWith("human-1", "阿明（新）"),
    );
    expect(screen.getByText("阿明（新）")).toBeInTheDocument();
  });

  it("deletes a human without remote resources locally only", async () => {
    vi.mocked(listHumans).mockResolvedValue([
      human({ id: "human-1", name: "阿明" }),
    ]);
    vi.mocked(deleteHuman).mockResolvedValue(undefined);

    render(<DigitalHumanManagement />);

    await waitFor(() =>
      expect(screen.getByText("阿明")).toBeInTheDocument(),
    );

    const row = screen.getByText("阿明").closest("li") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "删除" }));
    await waitFor(() =>
      expect(screen.getByRole("dialog")).toBeInTheDocument(),
    );
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "删除" }),
    );

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "本地删除成功，无远程资源",
      ),
    );
    expect(deleteHuman).toHaveBeenCalledWith("human-1");
  });

  it("cleans remote resources then deletes locally when cleanup succeeds", async () => {
    vi.mocked(listHumans).mockResolvedValue([
      human({
        id: "human-1",
        name: "阿明",
        avatar_id: "avatar-1",
        remote_status: "uploaded",
      }),
    ]);
    vi.mocked(getRecentBuildJob).mockResolvedValue(
      job({ id: "job-1", digital_human_id: "human-1" }),
    );
    vi.mocked(cleanupBuildJob).mockResolvedValue(
      job({ id: "job-1", status: "succeeded" }),
    );
    vi.mocked(deleteHuman).mockResolvedValue(undefined);

    render(<DigitalHumanManagement />);

    await waitFor(() =>
      expect(screen.getByText("阿明")).toBeInTheDocument(),
    );

    const row = screen.getByText("阿明").closest("li") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "删除" }));
    await waitFor(() =>
      expect(screen.getByRole("dialog")).toBeInTheDocument(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "清理远程资源并删除" }),
    );

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "本地删除成功，远程删除成功",
      ),
    );
    expect(cleanupBuildJob).toHaveBeenCalledWith("job-1");
    expect(deleteHuman).toHaveBeenCalledWith("human-1");
  });

  it("keeps the local record when remote cleanup fails and offers a retry", async () => {
    vi.mocked(listHumans).mockResolvedValue([
      human({
        id: "human-1",
        name: "阿明",
        avatar_id: "avatar-1",
        remote_status: "uploaded",
      }),
    ]);
    vi.mocked(getRecentBuildJob).mockResolvedValue(
      job({ id: "job-1", digital_human_id: "human-1" }),
    );
    vi.mocked(cleanupBuildJob).mockResolvedValue(
      job({ id: "job-1", status: "cleanup_failed" }),
    );

    render(<DigitalHumanManagement />);

    await waitFor(() =>
      expect(screen.getByText("阿明")).toBeInTheDocument(),
    );

    const row = screen.getByText("阿明").closest("li") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "删除" }));
    await waitFor(() =>
      expect(screen.getByRole("dialog")).toBeInTheDocument(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "清理远程资源并删除" }),
    );

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "本地删除未完成，远程清理失败（可再重试清理）",
      ),
    );
    expect(cleanupBuildJob).toHaveBeenCalledWith("job-1");
    expect(deleteHuman).not.toHaveBeenCalled();
  });

  it("reports skip-local-delete as remote cleanup pending, never cleaned", async () => {
    vi.mocked(listHumans).mockResolvedValue([
      human({
        id: "human-1",
        name: "阿明",
        avatar_id: "avatar-1",
        remote_status: "uploaded",
      }),
    ]);
    vi.mocked(getRecentBuildJob).mockResolvedValue(
      job({ id: "job-1", digital_human_id: "human-1" }),
    );
    vi.mocked(deleteHuman).mockResolvedValue(undefined);

    render(<DigitalHumanManagement />);

    await waitFor(() =>
      expect(screen.getByText("阿明")).toBeInTheDocument(),
    );

    const row = screen.getByText("阿明").closest("li") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "删除" }));
    await waitFor(() =>
      expect(screen.getByRole("dialog")).toBeInTheDocument(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "跳过远程清理，仅删除本地记录" }),
    );

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "本地删除成功，远程清理待处理",
      ),
    );
    expect(cleanupBuildJob).not.toHaveBeenCalled();
    expect(deleteHuman).toHaveBeenCalledWith("human-1");
  });

  it("shows an ApiError message when the list fails to load", async () => {
    vi.mocked(listHumans).mockRejectedValue(
      apiError("读取数字人失败：服务不可用", 503),
    );

    render(<DigitalHumanManagement />);

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "读取数字人失败：服务不可用",
      ),
    );
  });

  it("shows an ApiError message on a failed default switch", async () => {
    vi.mocked(listHumans).mockResolvedValue([
      human({ id: "human-1", name: "阿明", is_default: true }),
      human({ id: "human-2", name: "小美", is_default: false }),
    ]);
    vi.mocked(setDefaultHuman).mockRejectedValue(
      apiError("无法切换默认数字人", 409),
    );

    render(<DigitalHumanManagement />);

    await waitFor(() =>
      expect(screen.getByText("阿明")).toBeInTheDocument(),
    );

    const second = screen
      .getByText("小美")
      .closest("li") as HTMLElement;
    fireEvent.click(within(second).getByRole("button", { name: "设为默认" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "无法切换默认数字人",
      ),
    );
  });
});

describe("deleteDigitalHumanWithCleanup", () => {
  it("reports provider-unsupported when cleanup is requested without a job", async () => {
    vi.mocked(deleteHuman).mockResolvedValue(undefined);
    const result = await deleteDigitalHumanWithCleanup(
      human({ id: "human-1", avatar_id: "avatar-1" }),
      null,
      "cleanup",
    );
    expect(result).toEqual({
      localDeleted: true,
      humanId: "human-1",
      remote: { kind: "unsupported" },
    });
    expect(deleteHuman).toHaveBeenCalledWith("human-1");
  });

  it("reports pending for a cleanup that returns cleanup_pending", async () => {
    vi.mocked(cleanupBuildJob).mockResolvedValue(
      job({ id: "job-1", status: "cleanup_pending" }),
    );
    vi.mocked(deleteHuman).mockResolvedValue(undefined);
    const result = await deleteDigitalHumanWithCleanup(
      human({ id: "human-1", avatar_id: "avatar-1" }),
      job({ id: "job-1", digital_human_id: "human-1" }),
      "cleanup",
    );
    expect(result).toEqual({
      localDeleted: true,
      humanId: "human-1",
      remote: { kind: "pending" },
    });
    expect(deleteHuman).toHaveBeenCalledWith("human-1");
  });
});