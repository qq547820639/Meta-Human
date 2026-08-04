import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BuildJobData, DigitalHumanData } from "../../api/contracts";
import CreationFlow from "./CreationFlow";
import {
  buildDigitalHumanId,
  buildIdempotencyKey,
  cancelBuildJob,
  cleanupBuildJob,
  createBuildJob,
  getBuildJob,
  getDigitalHuman,
  retryBuildJob,
  startAvatarStream,
  stopAvatarStream,
} from "./avatarBuildClient";
import {
  capturePortrait,
  deleteMediaFile,
  getCapturePermissionStatus,
  startRecording,
  stopRecording,
} from "./captureClient";
import {
  pickPortraitFile,
  pickRecordingFile,
  validatePortraitFile,
  validateRecordingFile,
} from "./mediaClient";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: vi.fn((path: string) => `asset://${path}`),
}));

vi.mock("./mediaClient", () => ({
  pickPortraitFile: vi.fn(),
  pickRecordingFile: vi.fn(),
  validatePortraitFile: vi.fn(),
  validateRecordingFile: vi.fn(),
}));

vi.mock("./captureClient", () => ({
  capturePortrait: vi.fn(),
  deleteMediaFile: vi.fn(),
  getCapturePermissionStatus: vi.fn(),
  startRecording: vi.fn(),
  stopRecording: vi.fn(),
}));

vi.mock("./avatarBuildClient", () => ({
  buildDigitalHumanId: vi.fn(),
  buildIdempotencyKey: vi.fn(),
  cancelBuildJob: vi.fn(),
  cleanupBuildJob: vi.fn(),
  createBuildJob: vi.fn(),
  getBuildJob: vi.fn(),
  getDefaultDigitalHuman: vi.fn(),
  getDigitalHuman: vi.fn(),
  retryBuildJob: vi.fn(),
  startAvatarStream: vi.fn(),
  stopAvatarStream: vi.fn(),
}));

function runningJob(overrides: Partial<BuildJobData> = {}): BuildJobData {
  return {
    id: "job-1",
    status: "running",
    current_stage: "enroll_voice",
    stage_progress: null,
    succeeded_stages: ["validate_inputs"],
    retry_count: 0,
    error_code: null,
    error_detail: null,
    cancelled: false,
    digital_human_id: "human-1",
    created_at: "2026-08-04T00:00:00Z",
    updated_at: "2026-08-04T00:00:00Z",
    completed_at: null,
    ...overrides,
  };
}

function readyHuman(): DigitalHumanData {
  return {
    id: "human-1",
    name: "我的数字人",
    voice_provider_id: "provider",
    avatar_provider_id: "provider",
    voice_id: "voice-1",
    avatar_id: "avatar-1",
    creation_status: "ready",
    creation_progress: "done",
    is_default: true,
    error: null,
    portrait_path: "/tmp/portrait.jpg",
    recording_path: "/tmp/voice.wav",
    remote_status: null,
    created_at: "2026-08-04T00:00:00Z",
    updated_at: "2026-08-04T00:00:00Z",
  };
}

async function validateAndConfirm(portraitPath: string, recordingPath: string) {
  fireEvent.click(screen.getByRole("button", { name: "校验素材" }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "创建我的数字人" }),
    ).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "创建我的数字人" }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "确认上传并创建" }),
    ).toBeInTheDocument(),
  );
  fireEvent.click(screen.getByRole("button", { name: "确认上传并创建" }));
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CreationFlow", () => {
  it("keeps creation locked until both media samples validate", async () => {
    vi.mocked(validatePortraitFile).mockResolvedValue({
      format: "png",
      bytes: 128,
    });
    vi.mocked(validateRecordingFile).mockResolvedValue({
      durationMillis: 1000,
      sampleRate: 16000,
      bytes: 32000,
    });

    render(
      <CreationFlow
        portraitPath="/tmp/portrait.png"
        recordingPath="/tmp/voice.wav"
      />,
    );

    expect(
      screen.getByRole("button", { name: "创建我的数字人" }),
    ).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "校验素材" }));

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "创建我的数字人" }),
      ).toBeEnabled(),
    );
    expect(screen.getByText(/人像已校验：png/)).toBeInTheDocument();
    expect(screen.getByText(/录音已校验：1000ms/)).toBeInTheDocument();
  });

  it("shows one safe error when media paths are missing", () => {
    render(<CreationFlow />);

    fireEvent.click(screen.getByRole("button", { name: "校验素材" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "请先选择人像照片和声音录音。",
    );
    expect(
      screen.getByRole("button", { name: "创建我的数字人" }),
    ).toBeDisabled();
  });

  it("shows real camera and microphone permission states", async () => {
    vi.mocked(getCapturePermissionStatus).mockResolvedValue({
      camera: "authorized",
      microphone: "denied",
    });

    render(<CreationFlow />);
    fireEvent.click(screen.getByRole("button", { name: "检查权限" }));

    await waitFor(() =>
      expect(screen.getByText(/摄像头：已允许/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/麦克风：已拒绝/)).toBeInTheDocument();
  });

  it("captures a portrait and validates the captured file", async () => {
    vi.mocked(capturePortrait).mockResolvedValue(
      "/tmp/captured-portrait.jpg",
    );
    vi.mocked(validatePortraitFile).mockResolvedValue({
      format: "jpeg",
      bytes: 2048,
    });
    vi.mocked(validateRecordingFile).mockResolvedValue({
      durationMillis: 1000,
      sampleRate: 16000,
      bytes: 32000,
    });

    render(<CreationFlow recordingPath="/tmp/voice.wav" />);
    fireEvent.click(screen.getByRole("button", { name: "拍摄照片" }));

    await waitFor(() =>
      expect(
        screen.getByText(/已拍摄照片：captured-portrait\.jpg/),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "校验素材" }));

    await waitFor(() =>
      expect(validatePortraitFile).toHaveBeenCalledWith(
        "/tmp/captured-portrait.jpg",
      ),
    );
  });

  it("records voice and validates the captured file", async () => {
    vi.mocked(startRecording).mockResolvedValue(undefined);
    vi.mocked(stopRecording).mockResolvedValue("/tmp/captured-voice.wav");
    vi.mocked(deleteMediaFile).mockResolvedValue(undefined);
    vi.mocked(validatePortraitFile).mockResolvedValue({
      format: "jpeg",
      bytes: 2048,
    });
    vi.mocked(validateRecordingFile).mockResolvedValue({
      durationMillis: 1000,
      sampleRate: 16000,
      bytes: 32000,
    });

    render(<CreationFlow portraitPath="/tmp/portrait.jpg" />);
    fireEvent.click(screen.getByRole("button", { name: "录制声音" }));
    expect(startRecording).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "停止录音" })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "停止录音" }));

    await waitFor(() =>
      expect(
        screen.getByText(/已录制声音：captured-voice\.wav/),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "校验素材" }));

    await waitFor(() =>
      expect(validateRecordingFile).toHaveBeenCalledWith(
        "/tmp/captured-voice.wav",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "删除录音" }));
    await waitFor(() =>
      expect(
        screen.queryByText(/已录制声音：captured-voice\.wav/),
      ).not.toBeInTheDocument(),
    );
    expect(deleteMediaFile).toHaveBeenCalledWith(
      "/tmp/captured-voice.wav",
    );
  });

  it("picks existing media and validates it through the same flow", async () => {
    vi.mocked(pickPortraitFile).mockResolvedValue(
      "/tmp/picked-portrait.png",
    );
    vi.mocked(pickRecordingFile).mockResolvedValue(
      "/tmp/picked-voice.wav",
    );
    vi.mocked(validatePortraitFile).mockResolvedValue({
      format: "png",
      bytes: 2048,
    });
    vi.mocked(validateRecordingFile).mockResolvedValue({
      durationMillis: 1000,
      sampleRate: 16000,
      bytes: 32000,
    });

    const { container } = render(<CreationFlow />);
    fireEvent.click(screen.getByRole("button", { name: "选择照片" }));
    fireEvent.click(screen.getByRole("button", { name: "选择录音" }));

    await waitFor(() =>
      expect(
        screen.getByText(/已选择照片：picked-portrait\.png/),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByText(/已选择录音：picked-voice\.wav/),
    ).toBeInTheDocument();
    expect(screen.getByAltText("人像预览")).toHaveAttribute(
      "src",
      "asset:///tmp/picked-portrait.png",
    );
    expect(container.querySelector("audio")?.getAttribute("src")).toBe(
      "asset:///tmp/picked-voice.wav",
    );

    fireEvent.click(screen.getByRole("button", { name: "校验素材" }));
    await waitFor(() =>
      expect(validatePortraitFile).toHaveBeenCalledWith(
        "/tmp/picked-portrait.png",
      ),
    );
    expect(validateRecordingFile).toHaveBeenCalledWith(
      "/tmp/picked-voice.wav",
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "创建我的数字人" }),
      ).toBeEnabled(),
    );
  });

  it("requires revalidation when media is replaced", async () => {
    vi.mocked(pickPortraitFile)
      .mockResolvedValueOnce("/tmp/first.png")
      .mockResolvedValueOnce("/tmp/second.png");
    vi.mocked(pickRecordingFile).mockResolvedValue("/tmp/voice.wav");
    vi.mocked(validatePortraitFile).mockResolvedValue({
      format: "png",
      bytes: 2048,
    });
    vi.mocked(validateRecordingFile).mockResolvedValue({
      durationMillis: 1000,
      sampleRate: 16000,
      bytes: 32000,
    });

    render(<CreationFlow />);
    fireEvent.click(screen.getByRole("button", { name: "选择照片" }));
    fireEvent.click(screen.getByRole("button", { name: "选择录音" }));
    await waitFor(() =>
      expect(
        screen.getByText(/已选择照片：first\.png/),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByText(/已选择录音：voice\.wav/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "校验素材" }));

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "创建我的数字人" }),
      ).toBeEnabled(),
    );

    fireEvent.click(screen.getByRole("button", { name: "选择照片" }));

    await waitFor(() =>
      expect(screen.getByText(/人像尚未校验/)).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: "创建我的数字人" }),
    ).toBeDisabled();
  });

  it("builds the avatar via a build job and starts conversation", async () => {
    const onConversationStarted = vi.fn();
    vi.mocked(buildIdempotencyKey).mockReturnValue("media-12345678");
    vi.mocked(buildDigitalHumanId).mockReturnValue("human-1");
    vi.mocked(createBuildJob).mockResolvedValue(runningJob());
    vi.mocked(getBuildJob).mockResolvedValue(
      runningJob({ status: "succeeded" }),
    );
    vi.mocked(getDigitalHuman).mockResolvedValue(readyHuman());
    vi.mocked(startAvatarStream).mockResolvedValue({
      sessionId: "stream-1",
      streamUrl: "https://gpu.example.com/live/stream-1",
    });
    vi.mocked(validatePortraitFile).mockResolvedValue({
      format: "jpeg",
      bytes: 2048,
    });
    vi.mocked(validateRecordingFile).mockResolvedValue({
      durationMillis: 1000,
      sampleRate: 16000,
      bytes: 32000,
    });

    render(
      <CreationFlow
        portraitPath="/tmp/portrait.jpg"
        recordingPath="/tmp/voice.wav"
        onConversationStarted={onConversationStarted}
      />,
    );
    await validateAndConfirm("/tmp/portrait.jpg", "/tmp/voice.wav");

    await waitFor(() =>
      expect(screen.getByText(/头像构建完成：voice-1/)).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: "创建我的数字人" }),
    ).toBeDisabled();
    expect(createBuildJob).toHaveBeenCalledWith(
      expect.objectContaining({
        portraitPath: "/tmp/portrait.jpg",
        recordingPath: "/tmp/voice.wav",
        idempotencyKey: expect.any(String),
        digitalHumanId: expect.any(String),
      }),
    );
    expect(getDigitalHuman).toHaveBeenCalledWith("human-1");

    fireEvent.click(screen.getByRole("button", { name: "开始对话" }));
    await waitFor(() =>
      expect(screen.getByText("你的数字人会在这里回应你。")).toBeInTheDocument(),
    );
    expect(onConversationStarted).toHaveBeenCalledTimes(1);
    expect(startAvatarStream).toHaveBeenCalledWith("avatar-1", "voice-1");
  });

  it("requires explicit upload consent before creating a job", async () => {
    vi.mocked(validatePortraitFile).mockResolvedValue({
      format: "jpeg",
      bytes: 2048,
    });
    vi.mocked(validateRecordingFile).mockResolvedValue({
      durationMillis: 1000,
      sampleRate: 16000,
      bytes: 32000,
    });

    render(
      <CreationFlow
        portraitPath="/tmp/portrait.jpg"
        recordingPath="/tmp/voice.wav"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "校验素材" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "创建我的数字人" }),
      ).toBeEnabled(),
    );

    fireEvent.click(screen.getByRole("button", { name: "创建我的数字人" }));
    expect(createBuildJob).not.toHaveBeenCalled();
    expect(
      screen.getByText(/照片和声音会发送到你选择的远程服务/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(
      screen.queryByRole("button", { name: "确认上传并创建" }),
    ).not.toBeInTheDocument();
  });

  it("shows honest build progress and cancels through the server", async () => {
    vi.mocked(createBuildJob).mockResolvedValue(runningJob());
    vi.mocked(getBuildJob).mockResolvedValueOnce(runningJob()).mockResolvedValue(
      runningJob({ status: "cancelled", cancelled: true }),
    );
    vi.mocked(cancelBuildJob).mockResolvedValue(
      runningJob({ status: "cancelling", cancelled: true }),
    );
    vi.mocked(cleanupBuildJob).mockResolvedValue(runningJob());
    vi.mocked(validatePortraitFile).mockResolvedValue({
      format: "jpeg",
      bytes: 2048,
    });
    vi.mocked(validateRecordingFile).mockResolvedValue({
      durationMillis: 1000,
      sampleRate: 16000,
      bytes: 32000,
    });

    render(
      <CreationFlow
        portraitPath="/tmp/portrait.jpg"
        recordingPath="/tmp/voice.wav"
      />,
    );
    await validateAndConfirm("/tmp/portrait.jpg", "/tmp/voice.wav");

    expect(screen.getByRole("status")).toHaveTextContent(
      "正在塑造你的数字人，请稍候…",
    );
    expect(
      screen.getByRole("button", { name: "取消创建" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "创建我的数字人" }),
    ).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "取消创建" }));
    await waitFor(() =>
      expect(
        screen.getByText("已取消创建，可以重新开始。"),
      ).toBeInTheDocument(),
    );
    expect(cancelBuildJob).toHaveBeenCalledWith("job-1");
    expect(screen.queryByText(/头像构建完成/)).not.toBeInTheDocument();
  });

  it("shows one recovery action after failure and retries", async () => {
    vi.mocked(createBuildJob)
      .mockResolvedValueOnce(runningJob())
      .mockResolvedValueOnce(runningJob());
    vi.mocked(getBuildJob)
      .mockResolvedValueOnce(
        runningJob({
          status: "failed",
          error_detail: "构建失败",
        }),
      )
      .mockResolvedValue(runningJob({ status: "succeeded" }));
    vi.mocked(retryBuildJob).mockResolvedValue(runningJob());
    vi.mocked(getDigitalHuman).mockResolvedValue(readyHuman());
    vi.mocked(validatePortraitFile).mockResolvedValue({
      format: "jpeg",
      bytes: 2048,
    });
    vi.mocked(validateRecordingFile).mockResolvedValue({
      durationMillis: 1000,
      sampleRate: 16000,
      bytes: 32000,
    });

    render(
      <CreationFlow
        portraitPath="/tmp/portrait.jpg"
        recordingPath="/tmp/voice.wav"
      />,
    );
    await validateAndConfirm("/tmp/portrait.jpg", "/tmp/voice.wav");

    await waitFor(() =>
      expect(screen.getByText("构建失败")).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: "重试创建" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "重试创建" }));
    await waitFor(() =>
      expect(screen.getByText(/头像构建完成：voice-1/)).toBeInTheDocument(),
    );
    expect(retryBuildJob).toHaveBeenCalledWith("job-1");
  });

  it("returns to the readiness view when requested", () => {
    const onBack = vi.fn();
    render(<CreationFlow onBack={onBack} />);
    fireEvent.click(screen.getByRole("button", { name: "返回准备状态" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});