import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import CreationFlow from "./CreationFlow";
import {
  buildAvatar,
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
  buildAvatar: vi.fn(),
  startAvatarStream: vi.fn(),
  stopAvatarStream: vi.fn(),
}));

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

  it("builds the avatar after both media samples validate", async () => {
    const onConversationStarted = vi.fn();
    vi.mocked(buildAvatar).mockResolvedValue({
      voiceId: "voice-1",
      avatarId: "avatar-1",
    });
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
    fireEvent.click(
      screen.getByRole("button", { name: "确认上传并创建" }),
    );

    await waitFor(() =>
      expect(screen.getByText(/头像构建完成：voice-1/)).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: "创建我的数字人" }),
    ).toBeDisabled();
    expect(buildAvatar).toHaveBeenCalledWith(
      "/tmp/portrait.jpg",
      "/tmp/voice.wav",
      expect.any(AbortSignal),
    );

    fireEvent.click(screen.getByRole("button", { name: "开始对话" }));
    await waitFor(() =>
      expect(screen.getByText("第一次回应")).toBeInTheDocument(),
    );
    expect(onConversationStarted).toHaveBeenCalledTimes(1);
    expect(startAvatarStream).toHaveBeenCalledWith("avatar-1", "voice-1");
  });

  it("requires explicit upload consent before building", async () => {
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
    expect(buildAvatar).not.toHaveBeenCalled();
    expect(
      screen.getByText(/照片和声音会发送到你选择的远程服务/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(
      screen.queryByRole("button", { name: "确认上传并创建" }),
    ).not.toBeInTheDocument();
  });

  it("shows honest build progress and supports cancellation", async () => {
    let resolveBuild!: (value: {
      voiceId: string;
      avatarId: string;
    }) => void;
    vi.mocked(buildAvatar).mockReturnValue(
      new Promise((resolve) => {
        resolveBuild = resolve;
      }),
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
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "确认上传并创建" }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "确认上传并创建" }),
    );
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
    resolveBuild({ voiceId: "voice-x", avatarId: "avatar-x" });
    await waitFor(() =>
      expect(
        screen.getByText("已取消创建，可以重新开始。"),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText(/头像构建完成/)).not.toBeInTheDocument();
  });

  it("shows one recovery action after failure and retries", async () => {
    vi.mocked(buildAvatar)
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValueOnce({
        voiceId: "voice-y",
        avatarId: "avatar-y",
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
      />,
    );
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
    fireEvent.click(
      screen.getByRole("button", { name: "确认上传并创建" }),
    );

    await waitFor(() =>
      expect(
        screen.getByText("头像构建失败，请稍后重试。"),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: "重试创建" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "重试创建" }));
    await waitFor(() =>
      expect(screen.getByText(/头像构建完成：voice-y/)).toBeInTheDocument(),
    );
  });

  it("returns to the readiness view when requested", () => {
    const onBack = vi.fn();
    render(<CreationFlow onBack={onBack} />);
    fireEvent.click(screen.getByRole("button", { name: "返回准备状态" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
