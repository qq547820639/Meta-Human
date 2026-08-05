import { useEffect, useRef, useState } from "react";

import type { DigitalHumanData } from "../../api/contracts";
import {
  AvatarBuildState,
  BuildStage,
  buildFailed,
  buildSucceeded,
  cancelRequested,
  initialAvatarBuildState,
  jobAccepted,
  jobCancelled,
  jobUpdated,
  retryBuild,
  startBuild,
  validationSucceeded,
} from "./avatarBuild";
import {
  AvatarStreamResult,
  buildDigitalHumanId,
  buildIdempotencyKey,
  cancelBuildJob,
  cleanupBuildJob,
  createBuildJob,
  getBuildJob,
  getDefaultDigitalHuman,
  getDigitalHuman,
  retryBuildJob,
  startAvatarStream,
  stopAvatarStream,
} from "./avatarBuildClient";
import {
  CapturePermissionSnapshot,
  capturePortrait,
  deleteMediaFile,
  getCapturePermissionStatus,
  startRecording,
  stopRecording,
} from "./captureClient";
import {
  PortraitInfo,
  RecordingInfo,
  pickPortraitFile,
  pickRecordingFile,
  validatePortraitFile,
  validateRecordingFile,
} from "./mediaClient";

const POLL_INTERVAL_MS = 1500;

/** Terminal job statuses from `routes/avatar.py`; polling stops on these. */
const TERMINAL_STATUSES = new Set([
  "succeeded",
  "failed",
  "cancelled",
  "cleanup_pending",
  "cleanup_failed",
]);

/** Creation intent, mirroring the backend build-job `mode` field. */
export type CreationMode = "new" | "rebuild" | "copy";

function fileName(path: string | null | undefined): string | null {
  if (!path) return null;
  return path.split(/[\\/]/).pop() || path;
}

export interface UseCreationWizardProps {
  readonly portraitPath?: string;
  readonly recordingPath?: string;
  readonly mode?: CreationMode;
  readonly rebuildSource?: DigitalHumanData | null;
  readonly onBack?: () => void;
  readonly onConversationStarted?: () => void;
}

export interface UseCreationWizardResult {
  readonly mode: CreationMode;
  readonly rebuildMode: boolean;
  readonly copyMode: boolean;
  readonly portraitInfo: PortraitInfo | null;
  readonly recordingInfo: RecordingInfo | null;
  readonly permissions: CapturePermissionSnapshot | null;
  readonly capturedPortraitPath: string | null;
  readonly capturedRecordingPath: string | null;
  readonly pickedPortraitPath: string | null;
  readonly pickedRecordingPath: string | null;
  readonly human: DigitalHumanData | null;
  readonly avatarStream: AvatarStreamResult | null;
  readonly startingConversation: boolean;
  readonly conversationStarted: boolean;
  readonly error: string | null;
  readonly validating: boolean;
  readonly recordingVoice: boolean;
  readonly confirmingUpload: boolean;
  readonly buildState: AvatarBuildState;
  readonly canCreate: boolean;
  readonly resolvedPortraitPath: string | null | undefined;
  readonly resolvedRecordingPath: string | null | undefined;
  readonly buildBusy: boolean;
  readonly portraitLabel: string | null;
  readonly recordingLabel: string | null;
  readonly buildProgressLabel: string | null;
  readonly setConfirmingUpload: (value: boolean) => void;
  readonly handleValidate: () => Promise<void>;
  readonly handleCheckPermissions: () => Promise<void>;
  readonly handleCapturePortrait: () => Promise<void>;
  readonly handleCaptureRecording: () => Promise<void>;
  readonly handleDeletePortrait: () => Promise<void>;
  readonly handleDeleteRecording: () => Promise<void>;
  readonly handlePickPortrait: () => Promise<void>;
  readonly handlePickRecording: () => Promise<void>;
  readonly handleCreate: (confirmed?: boolean) => Promise<void>;
  readonly handleCancelBuild: () => Promise<void>;
  readonly handleRetryBuild: () => Promise<void>;
  readonly handleBack: () => void;
  readonly handleStartConversation: () => Promise<void>;
  readonly handleCapturePortraitWithState: () => void;
  readonly handleCaptureRecordingWithState: () => void;
  readonly handlePickPortraitWithState: () => void;
  readonly handlePickRecordingWithState: () => void;
  readonly handleValidateWithState: () => void;
  readonly handleCheckPermissionsWithState: () => void;
}

/**
 * Encapsulates the creation wizard business logic: media capture / pick /
 * validation, build-job submission and polling, cancellation / retry, and the
 * post-build avatar-stream handoff to the conversation workspace. The
 * component layer is a thin renderer over this hook.
 */
export function useCreationWizard({
  portraitPath,
  recordingPath,
  mode = "new",
  rebuildSource,
  onBack,
  onConversationStarted,
}: UseCreationWizardProps): UseCreationWizardResult {
  const resolvedMode = mode;
  const rebuildMode = resolvedMode === "rebuild";
  const copyMode = resolvedMode === "copy";
  const sourceHuman = rebuildSource ?? null;
  const [portraitInfo, setPortraitInfo] = useState<PortraitInfo | null>(
    null,
  );
  const [recordingInfo, setRecordingInfo] =
    useState<RecordingInfo | null>(null);
  const [permissions, setPermissions] =
    useState<CapturePermissionSnapshot | null>(null);
  const [capturedPortraitPath, setCapturedPortraitPath] =
    useState<string | null>(null);
  const [capturedRecordingPath, setCapturedRecordingPath] =
    useState<string | null>(null);
  const [pickedPortraitPath, setPickedPortraitPath] =
    useState<string | null>(null);
  const [pickedRecordingPath, setPickedRecordingPath] =
    useState<string | null>(null);
  const [human, setHuman] = useState<DigitalHumanData | null>(null);
  const [avatarStream, setAvatarStream] =
    useState<AvatarStreamResult | null>(null);
  const [startingConversation, setStartingConversation] = useState(false);
  const [conversationStarted, setConversationStarted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [recordingVoice, setRecordingVoice] = useState(false);
  const [confirmingUpload, setConfirmingUpload] = useState(false);
  const [buildState, setBuildState] = useState<AvatarBuildState>(
    initialAvatarBuildState,
  );
  const buildJobIdRef = useRef<string | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  const streamSessionRef = useRef<string | null>(null);

  function stopPolling() {
    if (pollTimerRef.current !== null) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }

  useEffect(
    () => () => {
      stopPolling();
      if (streamSessionRef.current) {
        void stopAvatarStream(streamSessionRef.current);
      }
    },
    [],
  );

  async function pollOnce(jobId: string) {
    try {
      const job = await getBuildJob(jobId);
      if (TERMINAL_STATUSES.has(job.status)) {
        stopPolling();
        if (job.status === "succeeded") {
          setBuildState((current) => buildSucceeded(current, job));
          await loadDigitalHuman(job.digital_human_id);
        } else if (job.status === "cancelled") {
          setBuildState((current) => jobCancelled(current, job));
          void cleanupBuildJob(jobId).catch(() => {
            // Cleanup is best-effort; the cancelled state is already shown.
          });
        } else if (job.status === "failed") {
          setBuildState((current) =>
            buildFailed(current, job.error_detail ?? "头像构建失败，请稍后重试。"),
          );
        } else {
          setBuildState((current) => jobUpdated(current, job));
        }
      } else {
        setBuildState((current) => jobUpdated(current, job));
      }
    } catch {
      stopPolling();
      setBuildState((current) =>
        buildFailed(current, "头像构建失败，请稍后重试。"),
      );
    }
  }

  function startPolling(jobId: string) {
    stopPolling();
    void pollOnce(jobId);
    pollTimerRef.current = window.setInterval(() => {
      void pollOnce(jobId);
    }, POLL_INTERVAL_MS);
  }

  async function loadDigitalHuman(digitalHumanId: string | null) {
    if (digitalHumanId) {
      try {
        setHuman(await getDigitalHuman(digitalHumanId));
        return;
      } catch {
        // Fall through to the default human below.
      }
    }
    try {
      setHuman(await getDefaultDigitalHuman());
    } catch {
      // No ready human yet; conversation start stays disabled.
    }
  }

  const canCreate = portraitInfo !== null && recordingInfo !== null;
  const resolvedPortraitPath =
    portraitPath ??
    sourceHuman?.portrait_path ??
    capturedPortraitPath ??
    pickedPortraitPath;
  const resolvedRecordingPath =
    recordingPath ??
    sourceHuman?.recording_path ??
    capturedRecordingPath ??
    pickedRecordingPath;
  const buildBusy =
    buildState.stage === "validating" ||
    buildState.stage === "submitting" ||
    buildState.stage === "building" ||
    buildState.stage === "cancelling" ||
    buildState.stage === "cleanup";
  const portraitLabel = capturedPortraitPath
    ? `已拍摄照片：${fileName(capturedPortraitPath)}`
    : pickedPortraitPath
      ? `已选择照片：${fileName(pickedPortraitPath)}`
    : portraitPath
      ? `已选择照片：${fileName(portraitPath)}`
      : null;
  const recordingLabel = capturedRecordingPath
    ? `已录制声音：${fileName(capturedRecordingPath)}`
    : pickedRecordingPath
      ? `已选择录音：${fileName(pickedRecordingPath)}`
    : recordingPath
      ? `已选择录音：${fileName(recordingPath)}`
      : null;

  async function handleValidate() {
    setError(null);
    setValidating(true);
    try {
      if (!resolvedPortraitPath || !resolvedRecordingPath) {
        setError("请先选择人像照片和声音录音。");
        return;
      }
      const [portrait, recording] = await Promise.all([
        validatePortraitFile(resolvedPortraitPath),
        validateRecordingFile(resolvedRecordingPath),
      ]);
      setPortraitInfo(portrait);
      setRecordingInfo(recording);
    } catch {
      setError("素材校验失败，请重新选择后再试。");
    } finally {
      setValidating(false);
    }
  }

  async function handleCheckPermissions() {
    setError(null);
    try {
      setPermissions(await getCapturePermissionStatus());
    } catch {
      setError("无法读取摄像头或麦克风权限。");
    }
  }

  async function handleCapturePortrait() {
    setError(null);
    try {
      const path = await capturePortrait();
      setCapturedPortraitPath(path);
      setPickedPortraitPath(null);
      setPortraitInfo(null);
    } catch {
      setError("无法拍摄照片，请检查摄像头权限后重试。");
    }
  }

  async function handleCaptureRecording() {
    setError(null);
    if (recordingVoice) {
      try {
        const path = await stopRecording();
        setCapturedRecordingPath(path);
        setPickedRecordingPath(null);
        setRecordingInfo(null);
      } catch {
        setError("无法保存录音，请重试。");
      } finally {
        setRecordingVoice(false);
      }
      return;
    }
    try {
      await startRecording();
      setRecordingVoice(true);
    } catch {
      setError("无法开始录音，请检查麦克风权限后重试。");
    }
  }

  async function handleDeletePortrait() {
    if (!resolvedPortraitPath) return;
    setError(null);
    try {
      await deleteMediaFile(resolvedPortraitPath);
    } catch {
      // A stale temp file is not a reason to block replacing the portrait.
    }
    setCapturedPortraitPath(null);
    setPickedPortraitPath(null);
    setPortraitInfo(null);
  }

  async function handleDeleteRecording() {
    if (!resolvedRecordingPath) return;
    setError(null);
    try {
      await deleteMediaFile(resolvedRecordingPath);
    } catch {
      // A stale temp file is not a reason to block replacing the recording.
    }
    setCapturedRecordingPath(null);
    setPickedRecordingPath(null);
    setRecordingInfo(null);
  }

  async function handlePickPortrait() {
    setError(null);
    try {
      const path = await pickPortraitFile();
      setPickedPortraitPath(path);
      setCapturedPortraitPath(null);
      setPortraitInfo(null);
    } catch {
      setError("无法读取所选照片，请重新选择。");
    }
  }

  async function handlePickRecording() {
    setError(null);
    try {
      const path = await pickRecordingFile();
      setPickedRecordingPath(path);
      setCapturedRecordingPath(null);
      setRecordingInfo(null);
    } catch {
      setError("无法读取所选录音，请重新选择。");
    }
  }

  async function handleCreate(confirmed = false) {
    if (!resolvedPortraitPath || !resolvedRecordingPath) {
      setError("请先准备好照片和录音。");
      return;
    }
    if (!confirmed && !confirmingUpload) {
      setConfirmingUpload(true);
      window.setTimeout(() => setConfirmingUpload(false), 3000);
      return;
    }
    setConfirmingUpload(false);
    setError(null);
    setBuildState((current) => validationSucceeded(startBuild(current)));
    try {
      const idempotencyKey = buildIdempotencyKey(
        resolvedPortraitPath,
        resolvedRecordingPath,
      );
      // For rebuild / copy the build targets the SOURCE human id; the backend
      // updates the same record (rebuild) or derives a new record (copy).
      const digitalHumanId =
        sourceHuman !== null
          ? sourceHuman.id
          : buildDigitalHumanId(resolvedPortraitPath, resolvedRecordingPath);
      const job = await createBuildJob({
        portraitPath: resolvedPortraitPath,
        recordingPath: resolvedRecordingPath,
        idempotencyKey,
        digitalHumanId,
        mode: resolvedMode,
      });
      buildJobIdRef.current = job.id;
      setBuildState((current) => jobAccepted(current, job));
      startPolling(job.id);
    } catch {
      setBuildState((current) =>
        buildFailed(current, "头像构建失败，请稍后重试。"),
      );
    }
  }

  async function handleCancelBuild() {
    const jobId = buildJobIdRef.current;
    if (!jobId) return;
    setError(null);
    setBuildState((current) => cancelRequested(current));
    try {
      await cancelBuildJob(jobId);
    } catch {
      // The job may already be terminal; the poll below will settle it.
    }
    startPolling(jobId);
  }

  async function handleRetryBuild() {
    const jobId = buildJobIdRef.current;
    if (!jobId) return;
    setError(null);
    setBuildState((current) => retryBuild(current));
    try {
      const job = await retryBuildJob(jobId);
      buildJobIdRef.current = job.id;
      setBuildState((current) => jobAccepted(current, job));
      startPolling(job.id);
    } catch {
      setBuildState((current) =>
        buildFailed(current, "重试失败，请稍后重试。"),
      );
    }
  }

  function handleCapturePortraitWithState() {
    if (buildBusy) return;
    void handleCapturePortrait();
  }

  function handleCaptureRecordingWithState() {
    if (buildBusy) return;
    void handleCaptureRecording();
  }

  function handlePickPortraitWithState() {
    if (buildBusy) return;
    void handlePickPortrait();
  }

  function handlePickRecordingWithState() {
    if (buildBusy) return;
    void handlePickRecording();
  }

  function handleValidateWithState() {
    if (buildBusy) return;
    void handleValidate();
  }

  function handleCheckPermissionsWithState() {
    if (buildBusy) return;
    void handleCheckPermissions();
  }

  function handleBack() {
    if (buildState.stage === "cancelled" || buildState.stage === "failed") {
      const jobId = buildJobIdRef.current;
      if (jobId) {
        void cleanupBuildJob(jobId).catch(() => {
          // Best-effort cleanup of remote resources.
        });
      }
    }
    stopPolling();
    if (streamSessionRef.current) {
      void stopAvatarStream(streamSessionRef.current);
      streamSessionRef.current = null;
    }
    onBack?.();
  }

  async function handleStartConversation() {
    if (
      !human ||
      !human.voice_id ||
      !human.avatar_id ||
      !resolvedPortraitPath
    ) {
      return;
    }
    setError(null);
    setStartingConversation(true);
    try {
      const stream = await startAvatarStream(human.avatar_id, human.voice_id);
      setAvatarStream(stream);
      streamSessionRef.current = stream.sessionId;
    } catch {
      setAvatarStream(null);
    } finally {
      setStartingConversation(false);
      setConversationStarted(true);
      onConversationStarted?.();
    }
  }

  const job = buildState.job;
  const buildProgressLabel = job
    ? `状态：${job.status} · 当前阶段：${job.current_stage} · 已完成：${job.succeeded_stages.join("、") || "无"}`
    : null;

  return {
    mode: resolvedMode,
    rebuildMode,
    copyMode,
    portraitInfo,
    recordingInfo,
    permissions,
    capturedPortraitPath,
    capturedRecordingPath,
    pickedPortraitPath,
    pickedRecordingPath,
    human,
    avatarStream,
    startingConversation,
    conversationStarted,
    error,
    validating,
    recordingVoice,
    confirmingUpload,
    buildState,
    canCreate,
    resolvedPortraitPath,
    resolvedRecordingPath,
    buildBusy,
    portraitLabel,
    recordingLabel,
    buildProgressLabel,
    setConfirmingUpload,
    handleValidate,
    handleCheckPermissions,
    handleCapturePortrait,
    handleCaptureRecording,
    handleDeletePortrait,
    handleDeleteRecording,
    handlePickPortrait,
    handlePickRecording,
    handleCreate,
    handleCancelBuild,
    handleRetryBuild,
    handleBack,
    handleStartConversation,
    handleCapturePortraitWithState,
    handleCaptureRecordingWithState,
    handlePickPortraitWithState,
    handlePickRecordingWithState,
    handleValidateWithState,
    handleCheckPermissionsWithState,
  };
}

/** Presentational labels for the build state machine stages. */
export const buildStageLabels: Record<BuildStage, string> = {
  idle: "等待开始",
  validating: "正在校验素材",
  submitting: "正在提交创建任务",
  building: "正在塑造形象",
  cancelling: "正在取消",
  cancelled: "已取消",
  ready: "已完成",
  failed: "需要重试",
  cleanup: "正在清理",
};