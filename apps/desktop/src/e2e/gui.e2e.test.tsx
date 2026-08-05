/**
 * Desktop GUI E2E (Task 13).
 *
 * Drives the REAL Tauri UI components through @testing-library/react while
 * mocking only the network layer (the HTTP clients / Tauri `invoke` bindings),
 * so every scenario exercises the actual DOM / state transitions a user would
 * see. This is the "近似 GUI 的集成测试" approach: real components, real state
 * machines, mocked transport.
 *
 * The 12 scenarios in the spec are covered below. Scenarios that would need a
 * real GPU / TTS / hardware (real avatar stream, real audio playback) use the
 * UI mock path and are annotated inline; the rest assert real UI state changes.
 *
 * Run: `pnpm vitest run src/e2e/gui.e2e.test.ts`
 */
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "../App";
import { ApiError } from "../api/client";
import type { ConversationStreamEvents } from "../features/conversation/conversationClient";
import {
  postConversationReply,
  stopGenerating,
  streamConversationReply,
  transcribeRecording,
} from "../features/conversation/conversationClient";
import {
  archiveConversation,
  clearConversationMessages,
  createConversation,
  deleteConversation,
  getConversation,
  listConversationMessages,
  listConversations,
  renameConversation,
  searchConversations,
  unarchiveConversation,
} from "../features/conversation/conversationManagementClient";
import {
  saveTextFile,
} from "../features/conversation/conversationExport";
import ConversationWorkspace from "../features/conversation/ConversationWorkspace";
import {
  capturePortrait,
  deleteCapturedTempMedia,
  deleteMediaFile,
  getCapturePermissionStatus,
  startRecording,
  stopRecording,
} from "../features/creation/captureClient";
import CreationFlow from "../features/creation/CreationFlow";
import {
  cancelBuildJob,
  cleanupBuildJob,
  createBuildJob,
  deleteHuman,
  getBuildJob,
  getDefaultDigitalHuman,
  getDigitalHuman,
  getLatestBuildJobForHuman,
  listHumans,
  renameHuman,
  retryBuildJob,
  setDefaultHuman,
  startAvatarStream,
} from "../features/creation/avatarBuildClient";
import {
  pickPortraitFile,
  pickRecordingFile,
  validatePortraitFile,
  validateRecordingFile,
} from "../features/creation/mediaClient";
import DigitalHumanManagement from "../features/manage/DigitalHumanManagement";
import {
  clearAllLocalData,
} from "../features/privacy/privacyClient";
import {
  listKnowledgeSources,
  deleteKnowledgeSource,
  listKnowledgeSourcesPage,
} from "../features/knowledge/knowledgeClient";
import {
  clearMemoryEntries,
  deleteMemoryEntry,
  listMemoryEntries,
  updateMemoryEntry,
} from "../features/memory/memoryClient";
import {
  checkLocalProvider,
  checkRemoteProvider,
  exchangeFeishuCode,
  loadAppSettings,
  openFeishuAuthorization,
  resetAllSettings,
  restartSidecar,
  saveAppSettings,
  startFeishuOauth,
} from "../features/settings/settingsClient";
import Settings from "../features/settings/Settings";
import { useReadiness, type UseReadinessResult } from "../features/readiness/useReadiness";
import { useRestoreState, type RestoreState } from "../features/restore/useRestoreState";

// --- Tauri bindings ---------------------------------------------------------
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: vi.fn((path: unknown) => `asset://${String(path)}`),
  invoke: vi.fn(),
}));

// --- network / HTTP clients (transport mocked, UI real) ---------------------
vi.mock("../features/conversation/conversationClient", () => ({
  postConversationReply: vi.fn(),
  streamConversationReply: vi.fn(),
  stopGenerating: vi.fn(),
  transcribeRecording: vi.fn(),
}));

vi.mock("../features/conversation/conversationManagementClient", () => ({
  listConversations: vi.fn(),
  searchConversations: vi.fn(),
  createConversation: vi.fn(),
  getConversation: vi.fn(),
  listConversationMessages: vi.fn(),
  renameConversation: vi.fn(),
  archiveConversation: vi.fn(),
  unarchiveConversation: vi.fn(),
  deleteConversation: vi.fn(),
  clearConversationMessages: vi.fn(),
}));

vi.mock("../features/conversation/conversationExport", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../features/conversation/conversationExport")>();
  return { ...actual, saveTextFile: vi.fn() };
});

vi.mock("../features/creation/captureClient", () => ({
  capturePortrait: vi.fn(),
  startRecording: vi.fn(),
  stopRecording: vi.fn(),
  deleteMediaFile: vi.fn(),
  getCapturePermissionStatus: vi.fn(),
  deleteCapturedTempMedia: vi.fn(),
}));

vi.mock("../features/creation/mediaClient", () => ({
  pickPortraitFile: vi.fn(),
  pickRecordingFile: vi.fn(),
  validatePortraitFile: vi.fn(),
  validateRecordingFile: vi.fn(),
}));

vi.mock("../features/creation/avatarBuildClient", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../features/creation/avatarBuildClient")>();
  return {
    ...actual,
    createBuildJob: vi.fn(),
    cancelBuildJob: vi.fn(),
    cleanupBuildJob: vi.fn(),
    deleteHuman: vi.fn(),
    getDefaultDigitalHuman: vi.fn(),
    getDigitalHuman: vi.fn(),
    getBuildJob: vi.fn(),
    getLatestBuildJobForHuman: vi.fn(),
    listHumans: vi.fn(),
    renameHuman: vi.fn(),
    retryBuildJob: vi.fn(),
    setDefaultHuman: vi.fn(),
    startAvatarStream: vi.fn(),
  };
});

vi.mock("../features/settings/settingsClient", () => ({
  loadAppSettings: vi.fn(),
  saveAppSettings: vi.fn(),
  restartSidecar: vi.fn(),
  resetAllSettings: vi.fn(),
  checkLocalProvider: vi.fn(),
  checkRemoteProvider: vi.fn(),
  openFeishuAuthorization: vi.fn(),
  exchangeFeishuCode: vi.fn(),
  startFeishuOauth: vi.fn(),
}));

vi.mock("../features/knowledge/knowledgeClient", () => ({
  listKnowledgeSources: vi.fn(),
  listKnowledgeSourcesPage: vi.fn(),
  deleteKnowledgeSource: vi.fn(),
}));

vi.mock("../features/memory/memoryClient", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../features/memory/memoryClient")>();
  return {
    ...actual,
    listMemoryEntries: vi.fn(),
    updateMemoryEntry: vi.fn(),
    deleteMemoryEntry: vi.fn(),
    clearMemoryEntries: vi.fn(),
  };
});

vi.mock("../features/privacy/privacyClient", () => ({
  clearAllLocalData: vi.fn(),
}));

// App-level hooks (used by the App-driven scenarios only).
vi.mock("../features/readiness/useReadiness", () => ({
  useReadiness: vi.fn(),
}));

vi.mock("../features/restore/useRestoreState", () => ({
  useRestoreState: vi.fn(),
}));

// --- shared fixtures --------------------------------------------------------
const emptyRestore: RestoreState = {
  defaultHuman: null,
  recentConversation: null,
  resumableJob: null,
  status: "empty",
  errorKind: undefined,
  isLoading: false,
  retry: vi.fn(),
};

const readyGate: UseReadinessResult = {
  snapshot: {
    requirements: [
      { id: "conversation", required: true, state: "passed" },
      { id: "voicePresence", required: true, state: "passed" },
      { id: "knowledge", required: true, state: "passed" },
    ],
    canCreate: true,
  },
  sidecarSnapshot: null,
  error: null,
  isLoading: false,
  recommendedAction: null,
  resume: vi.fn(),
};

function captureStream() {
  const capture: { events: ConversationStreamEvents } = { events: {} };
  vi.mocked(streamConversationReply).mockImplementation(
    async ({ events: nextEvents }) => {
      capture.events = nextEvents ?? {};
    },
  );
  return capture;
}

function sendQuestion(text: string) {
  fireEvent.change(screen.getByLabelText("问题"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
}

beforeEach(() => {
  vi.mocked(invoke).mockResolvedValue({
    baseUrl: "http://127.0.0.1:9999",
    bearerToken: "t",
  });
  vi.mocked(convertFileSrc).mockImplementation((p) => `asset://${String(p)}`);

  // conversation management client defaults
  vi.mocked(listConversations).mockResolvedValue({
    items: [],
    hasMore: false,
    total: 0,
  });
  vi.mocked(searchConversations).mockResolvedValue({
    items: [],
    hasMore: false,
    total: 0,
  });
  vi.mocked(listConversationMessages).mockResolvedValue({
    messages: [],
    nextCursor: null,
    hasMore: false,
  });
  vi.mocked(clearConversationMessages).mockResolvedValue(undefined);
  vi.mocked(renameConversation).mockResolvedValue(undefined);
  vi.mocked(archiveConversation).mockResolvedValue(undefined);
  vi.mocked(unarchiveConversation).mockResolvedValue(undefined);
  vi.mocked(deleteConversation).mockResolvedValue(undefined);

  // conversation client defaults
  vi.mocked(postConversationReply).mockResolvedValue({
    text: "",
    citations: [],
    grounded: false,
  });
  vi.mocked(stopGenerating).mockResolvedValue(true);
  vi.mocked(transcribeRecording).mockResolvedValue("");

  // capture / media defaults
  vi.mocked(deleteMediaFile).mockResolvedValue(undefined);
  vi.mocked(deleteCapturedTempMedia).mockResolvedValue(0);
  vi.mocked(validatePortraitFile).mockResolvedValue({
    format: "jpg",
  } as never);
  vi.mocked(validateRecordingFile).mockResolvedValue({
    durationMillis: 1000,
  } as never);

  // settings defaults
  vi.mocked(loadAppSettings).mockResolvedValue({
    settings: {},
    remoteApiKeySet: false,
    feishuAppSecretSet: false,
    feishuAccessTokenSet: false,
    feishuRefreshTokenSet: false,
  });
  vi.mocked(saveAppSettings).mockResolvedValue(undefined);
  vi.mocked(restartSidecar).mockResolvedValue(undefined);
  vi.mocked(resetAllSettings).mockResolvedValue(undefined);
  vi.mocked(checkLocalProvider).mockResolvedValue(true);
  vi.mocked(checkRemoteProvider).mockResolvedValue(true);

  // knowledge / memory / privacy defaults
  vi.mocked(listKnowledgeSources).mockResolvedValue([]);
  vi.mocked(listKnowledgeSourcesPage).mockResolvedValue({
    items: [],
    hasMore: false,
    total: 0,
  });
  vi.mocked(deleteKnowledgeSource).mockResolvedValue(undefined);
  vi.mocked(listMemoryEntries).mockResolvedValue({ entries: [], total: 0 });
  vi.mocked(updateMemoryEntry).mockResolvedValue({} as never);
  vi.mocked(deleteMemoryEntry).mockResolvedValue({} as never);
  vi.mocked(clearMemoryEntries).mockResolvedValue(undefined);
  vi.mocked(clearAllLocalData).mockResolvedValue(undefined);

  // export default
  vi.mocked(saveTextFile).mockResolvedValue("/tmp/export.md");

  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.resetAllMocks();
});

describe("desktop GUI E2E (Task 13)", () => {
  it("1. 首次启动：渲染加载态与 readiness 门禁空状态", async () => {
    vi.mocked(useReadiness).mockReturnValue({
      snapshot: null,
      sidecarSnapshot: null,
      error: null,
      isLoading: true,
      recommendedAction: null,
      resume: vi.fn(),
    });
    vi.mocked(useRestoreState).mockReturnValue(emptyRestore);

    const { rerender } = render(<App />);
    expect(
      screen.getByRole("status"),
    ).toHaveTextContent("正在确认工作室是否准备就绪…");
    expect(
      screen.queryByRole("button", { name: "创建我的数字人" }),
    ).not.toBeInTheDocument();

    // Ready gate resolves: the create entry point becomes available.
    vi.mocked(useReadiness).mockReturnValue(readyGate);
    rerender(<App />);
    expect(
      screen.getByRole("button", { name: "创建我的数字人" }),
    ).toBeEnabled();
  });

  it("2. 创建数字人：走 CreationFlow 校验素材并发起构建", async () => {
    const acceptedJob = {
      id: "job-1",
      status: "pending",
      current_stage: "image",
      stage_progress: null,
      succeeded_stages: [] as string[],
      retry_count: 0,
      error_code: null,
      error_detail: null,
      cancelled: false,
      digital_human_id: "human-1",
      created_at: "",
      updated_at: "",
      completed_at: null,
    };
    vi.mocked(createBuildJob).mockResolvedValue(acceptedJob as never);
    vi.mocked(getBuildJob).mockResolvedValue({
      ...acceptedJob,
      status: "running",
    } as never);

    render(<CreationFlow portraitPath="/tmp/p.jpg" recordingPath="/tmp/r.wav" />);

    fireEvent.click(screen.getByRole("button", { name: "校验素材" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "创建我的数字人" }),
      ).toBeEnabled(),
    );

    fireEvent.click(screen.getByRole("button", { name: "创建我的数字人" }));
    // Upload confirmation gate appears before the build is submitted.
    fireEvent.click(screen.getByRole("button", { name: "确认上传并创建" }));

    await waitFor(() => expect(createBuildJob).toHaveBeenCalled());
    expect(createBuildJob).toHaveBeenCalledWith(
      expect.objectContaining({
        portraitPath: "/tmp/p.jpg",
        recordingPath: "/tmp/r.wav",
        mode: "new",
      }),
    );
    // Build is now in flight: the primary action is locked.
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "创建我的数字人" }),
      ).toBeDisabled(),
    );
  });

  it("3. 导入知识：渲染知识来源并在删除后刷新列表", async () => {
    vi.mocked(listKnowledgeSources).mockResolvedValue([
      {
        documentId: "doc-1",
        title: "产品手册",
        sourceUrl: null,
        syncedAt: null,
        chunkCount: 12,
      },
    ]);

    render(<Settings />);
    await waitFor(() =>
      expect(screen.getByText(/产品手册 · 12 段/)).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "确认删除" }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));

    await waitFor(() =>
      expect(deleteKnowledgeSource).toHaveBeenCalledWith("doc-1"),
    );
    await waitFor(() =>
      expect(screen.getByText("还没有同步的知识来源。")).toBeInTheDocument(),
    );
  });

  it("4. 发送流式消息：输入→发送→消息渲染→状态流转", async () => {
    const capture = captureStream();

    render(<ConversationWorkspace />);
    sendQuestion("如何进入？");

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("正在理解问题"),
    );
    act(() => capture.events.onStage?.("retrieving"));
    act(() => capture.events.onToken?.("你好"));
    act(() => capture.events.onDone?.("你好"));

    await waitFor(() => expect(screen.getByText("你好")).toBeInTheDocument());
    expect(screen.getByText("如何进入？")).toBeInTheDocument();
    expect(streamConversationReply).toHaveBeenCalledTimes(1);
  });

  it("5. 停止生成：点击停止→状态中止", async () => {
    const capture = captureStream();
    vi.mocked(stopGenerating).mockResolvedValue(true);

    render(<ConversationWorkspace />);
    sendQuestion("慢慢说");
    capture.events.onGenerationStarted?.("gen-abc");
    capture.events.onToken?.("部分。");

    fireEvent.click(screen.getByRole("button", { name: "停止生成" }));
    await waitFor(() =>
      expect(stopGenerating).toHaveBeenCalledWith("gen-abc"),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("已停止生成。"),
    );
  });

  it("6. TTS 播放：audioBase64 写入→audio 元素出现", async () => {
    const capture = captureStream();
    const { container } = render(<ConversationWorkspace />);
    sendQuestion("你好");
    capture.events.onToken?.("回答。");
    capture.events.onDone?.("回答。");
    capture.events.onAudio?.("QUJD");

    await waitFor(() =>
      expect(container.querySelector("audio")).not.toBeNull(),
    );
    const audio = container.querySelector("audio") as HTMLAudioElement | null;
    expect(audio?.getAttribute("src")).toContain("data:audio/wav;base64,QUJD");
  });

  it("7. 切换会话：选择另一会话→消息切换", async () => {
    vi.mocked(listConversations).mockResolvedValue({
      items: [
        { id: "conv-a", name: "会话A" },
        { id: "conv-b", name: "会话B" },
      ],
      hasMore: false,
      total: 2,
    });
    vi.mocked(listConversationMessages).mockImplementation(
      async (id: string) => ({
        messages:
          id === "conv-b"
            ? [
                { role: "user", content: "B 的问题" },
                { role: "assistant", content: "B 的回答", grounded: true },
              ]
            : [
                { role: "user", content: "A 的问题" },
                { role: "assistant", content: "A 的回答", grounded: true },
              ],
        nextCursor: null,
        hasMore: false,
      }),
    );

    render(<ConversationWorkspace />);
    await waitFor(() => expect(screen.getByText("会话B")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "会话B" }));
    await waitFor(() => expect(screen.getByText("B 的回答")).toBeInTheDocument());
    expect(listConversationMessages).toHaveBeenCalledWith(
      "conv-b",
      expect.anything(),
    );
  });

  it("8. 重启恢复：重新渲染组件→恢复最近会话真实消息", async () => {
    vi.mocked(listConversationMessages).mockResolvedValue({
      messages: [
        { role: "user", content: "昨天问过" },
        { role: "assistant", content: "昨天回答过", grounded: true },
      ],
      nextCursor: null,
      hasMore: false,
    });

    const first = render(
      <ConversationWorkspace initialConversationId="conv-1" />,
    );
    await waitFor(() => expect(screen.getByText("昨天问过")).toBeInTheDocument());
    expect(screen.getByText("昨天回答过")).toBeInTheDocument();

    // Simulate an app restart: unmount and render the workspace again with the
    // same recent conversation id, asserting the same real messages return.
    first.unmount();
    cleanup();
    render(<ConversationWorkspace initialConversationId="conv-1" />);
    await waitFor(() => expect(screen.getByText("昨天问过")).toBeInTheDocument());
    expect(screen.getByText("昨天回答过")).toBeInTheDocument();
    // The restore path re-read the real messages (not a client-side cache).
    expect(listConversationMessages).toHaveBeenCalledTimes(2);
  });

  it("9. 切换默认数字人：管理页设为默认→回调刷新主界面", async () => {
    const humans = [
      {
        id: "human-1",
        name: "阿豪",
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
        created_at: "",
        updated_at: "",
      },
      {
        id: "human-2",
        name: "小雨",
        voice_provider_id: null,
        avatar_provider_id: null,
        voice_id: null,
        avatar_id: null,
        creation_status: "ready",
        creation_progress: null,
        is_default: false,
        error: null,
        portrait_path: null,
        recording_path: null,
        remote_status: null,
        created_at: "",
        updated_at: "",
      },
    ];
    vi.mocked(listHumans).mockResolvedValue({
      humans,
      hasMore: false,
      total: 2,
    } as never);
    vi.mocked(getLatestBuildJobForHuman).mockResolvedValue(null);
    vi.mocked(setDefaultHuman).mockResolvedValue({
      ...humans[1],
      is_default: true,
    } as never);

    const onSelectHuman = vi.fn();
    render(
      <DigitalHumanManagement onSelectHuman={onSelectHuman} />,
    );

    await waitFor(() => expect(screen.getByText("小雨")).toBeInTheDocument());
    expect(screen.getByText("阿豪")).toHaveTextContent("阿豪");

    fireEvent.click(screen.getAllByRole("button", { name: "设为默认" })[0]);
    await waitFor(() =>
      expect(
        screen.getByRole("status"),
      ).toHaveTextContent("已设为默认数字人：小雨"),
    );
    expect(onSelectHuman).toHaveBeenCalledWith(
      expect.objectContaining({ id: "human-2", is_default: true }),
    );
  });

  it("10. 弱网重试：网络错误→重试按钮→恢复", async () => {
    const networkError = new ApiError(
      {
        code: "stream_disconnected",
        message: "对话服务连接中断，请重试。",
        retryable: true,
        request_id: "req-weak",
        recommended_action: "请重试本次对话。",
        technical_message: null,
        details: null,
        provider: null,
        provider_status: null,
        timestamp: null,
      },
      200,
    );
    const capture: { events: ConversationStreamEvents } = { events: {} };
    vi.mocked(streamConversationReply)
      .mockRejectedValueOnce(networkError)
      .mockImplementationOnce(async ({ events }) => {
        capture.events = events ?? {};
      });

    render(<ConversationWorkspace />);
    sendQuestion("你好");

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "对话服务连接中断，请重试。",
      ),
    );
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    capture.events.onToken?.("恢复后的回答。");
    capture.events.onDone?.("恢复后的回答。");
    await waitFor(() =>
      expect(screen.getByText("恢复后的回答。")).toBeInTheDocument(),
    );
    expect(streamConversationReply).toHaveBeenCalledTimes(2);
  });

  it("11. 导出：点击导出→生成 Markdown 内容", async () => {
    const capture = captureStream();
    render(<ConversationWorkspace />);
    sendQuestion("你好");
    capture.events.onToken?.("回答。");
    capture.events.onDone?.("回答。");
    await waitFor(() => expect(screen.getByText("回答。")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "导出 Markdown" }));
    await waitFor(() => expect(saveTextFile).toHaveBeenCalled());
    const [fileName, content] = vi.mocked(saveTextFile).mock.calls[0];
    expect(fileName).toBe("未命名对话.md");
    expect(content).toContain("# 未命名对话");
    expect(content).toContain("回答。");
  });

  it("12. 设置变更与 Sidecar 重启：保存→重启→状态恢复", async () => {
    const onSettingsApplied = vi.fn();
    render(<Settings onSettingsApplied={onSettingsApplied} />);

    await waitFor(() =>
      expect(screen.getByLabelText("本地服务地址")).toBeInTheDocument(),
    );
    fireEvent.change(screen.getByLabelText("本地服务地址"), {
      target: { value: "http://localhost:1234" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存设置（未保存改动）" }));

    await waitFor(() => expect(saveAppSettings).toHaveBeenCalled());
    expect(restartSidecar).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "设置已保存，正在重新确认准备状态。",
      ),
    );
    expect(onSettingsApplied).toHaveBeenCalledTimes(1);
  });
});