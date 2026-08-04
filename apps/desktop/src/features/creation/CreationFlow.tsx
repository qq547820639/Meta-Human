import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";

import type { DigitalHumanData } from "../../api/contracts";
import ConversationWorkspace from "../conversation/ConversationWorkspace";
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
  CapturePermission,
  CapturePermissionSnapshot,
  capturePortrait,
  deleteMediaFile,
  getCapturePermissionStatus,
  startRecording,
  stopRecording,
} from "./captureClient";
import {
  pickPortraitFile,
  pickRecordingFile,
  PortraitInfo,
  RecordingInfo,
  validatePortraitFile,
  validateRecordingFile,
} from "./mediaClient";

const permissionLabels: Record<CapturePermission, string> = {
  notDetermined: "未确定",
  denied: "已拒绝",
  restricted: "受限",
  authorized: "已允许",
};

const POLL_INTERVAL_MS = 1500;

/** Terminal job statuses from `routes/avatar.py`; polling stops on these. */
const TERMINAL_STATUSES = new Set([
  "succeeded",
  "failed",
  "cancelled",
  "cleanup_pending",
  "cleanup_failed",
]);

interface CreationFlowProps {
  readonly portraitPath?: string;
  readonly recordingPath?: string;
  readonly onBack?: () => void;
  readonly onConversationStarted?: () => void;
}

const buildStageLabels: Record<BuildStage, string> = {
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

function fileName(path: string | null | undefined): string | null {
  if (!path) return null;
  return path.split(/[\\/]/).pop() || path;
}

export default function CreationFlow({
  portraitPath,
  recordingPath,
  onBack,
  onConversationStarted,
}: CreationFlowProps) {
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
    portraitPath ?? capturedPortraitPath ?? pickedPortraitPath;
  const resolvedRecordingPath =
    recordingPath ?? capturedRecordingPath ?? pickedRecordingPath;
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
      const digitalHumanId = buildDigitalHumanId(
        resolvedPortraitPath,
        resolvedRecordingPath,
      );
      const job = await createBuildJob({
        portraitPath: resolvedPortraitPath,
        recordingPath: resolvedRecordingPath,
        idempotencyKey,
        digitalHumanId,
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

  return (
    <>
      <section className="studio-status" aria-label="创建数字人">
        <div>
          {onBack ? (
            <button type="button" onClick={handleBack} disabled={buildBusy}>
              返回准备状态
            </button>
          ) : null}
          <p className="studio-status-title">塑造你的数字人</p>
          {resolvedPortraitPath ? (
            <div className="creation-preview">
              <img
                src={convertFileSrc(resolvedPortraitPath)}
                alt="人像预览"
              />
            </div>
          ) : null}
          {resolvedRecordingPath ? (
            <audio
              controls
              src={convertFileSrc(resolvedRecordingPath)}
            />
          ) : null}
          <p>
            {portraitInfo
              ? `人像已校验：${portraitInfo.format}`
              : "人像尚未校验"}
            {" · "}
            {recordingInfo
              ? `录音已校验：${recordingInfo.durationMillis}ms`
              : "录音尚未校验"}
          </p>
          <p>构建状态：{buildStageLabels[buildState.stage]}</p>
          {buildProgressLabel ? <p>{buildProgressLabel}</p> : null}
          {portraitLabel ? <p>{portraitLabel}</p> : null}
          {recordingLabel ? <p>{recordingLabel}</p> : null}
          {recordingVoice ? (
            <p role="status">正在录音…</p>
          ) : null}
          {error ? <p role="alert">{error}</p> : null}
          {buildState.stage === "failed" ? (
            <p role="alert">{buildState.error}</p>
          ) : null}
          {buildState.stage === "cancelled" ? (
            <p>已取消创建，可以重新开始。</p>
          ) : null}
          {buildBusy ? (
            <p role="status">正在塑造你的数字人，请稍候…</p>
          ) : null}
          <button
            type="button"
            onClick={handleCapturePortraitWithState}
            disabled={buildBusy}
          >
            拍摄照片
          </button>
          <button
            type="button"
            onClick={handlePickPortraitWithState}
            disabled={buildBusy}
          >
            选择照片
          </button>
          <button
            type="button"
            onClick={handleCaptureRecordingWithState}
            disabled={buildBusy}
          >
            {recordingVoice ? "停止录音" : "录制声音"}
          </button>
          <button
            type="button"
            onClick={handlePickRecordingWithState}
            disabled={buildBusy}
          >
            选择录音
          </button>
          <button
            type="button"
            onClick={handleCheckPermissionsWithState}
            disabled={buildBusy}
          >
            检查权限
          </button>
          {resolvedPortraitPath && !conversationStarted ? (
            <button
              type="button"
              onClick={() => void handleDeletePortrait()}
              disabled={buildBusy}
            >
              删除照片
            </button>
          ) : null}
          {resolvedRecordingPath && !conversationStarted ? (
            <button
              type="button"
              onClick={() => void handleDeleteRecording()}
              disabled={buildBusy}
            >
              删除录音
            </button>
          ) : null}
          {permissions ? (
            <p>
              摄像头：{permissionLabels[permissions.camera]} · 麦克风：
              {permissionLabels[permissions.microphone]}
            </p>
          ) : null}
          <button
            type="button"
            onClick={handleValidateWithState}
            disabled={validating || buildBusy}
          >
            校验素材
          </button>
          {buildBusy ? (
            <button type="button" onClick={() => void handleCancelBuild()}>
              取消创建
            </button>
          ) : null}
          {buildState.stage === "failed" ? (
            <button type="button" onClick={() => void handleRetryBuild()}>
              重试创建
            </button>
          ) : null}
          {confirmingUpload ? (
            <div role="alert">
              <p>
                照片和声音会发送到你选择的远程服务，用于创建你的数字人。
              </p>
              <button
                type="button"
                onClick={() => void handleCreate(true)}
              >
                确认上传并创建
              </button>
              <button
                type="button"
                onClick={() => setConfirmingUpload(false)}
              >
                取消
              </button>
            </div>
          ) : null}
          <button
            type="button"
            className="primary-action"
            disabled={!canCreate || buildBusy || buildState.stage === "ready"}
            onClick={() => void handleCreate()}
          >
            创建我的数字人
          </button>
          {human ? (
            <p>
              头像构建完成：{human.voice_id ?? "?"} / {human.avatar_id ?? "?"}
            </p>
          ) : null}
          {human && !conversationStarted ? (
            <button
              type="button"
              onClick={() => void handleStartConversation()}
              disabled={startingConversation}
            >
              {startingConversation ? "正在准备形象…" : "开始对话"}
            </button>
          ) : null}
        </div>
      </section>
      {conversationStarted ? (
        <ConversationWorkspace
          portraitPath={resolvedPortraitPath}
          streamUrl={avatarStream?.streamUrl ?? null}
        />
      ) : null}
    </>
  );
}