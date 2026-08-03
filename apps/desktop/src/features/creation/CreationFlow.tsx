import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";

import Conversation from "../conversation/Conversation";
import {
  AvatarBuildState,
  BuildStage,
  buildFailed,
  buildSucceeded,
  cancelBuild,
  initialAvatarBuildState,
  retryBuild,
  startBuild,
  validationSucceeded,
} from "./avatarBuild";
import {
  AvatarBuildResult,
  AvatarStreamResult,
  buildAvatar,
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

interface CreationFlowProps {
  readonly portraitPath?: string;
  readonly recordingPath?: string;
  readonly onBack?: () => void;
  readonly onConversationStarted?: () => void;
}

const buildStageLabels: Record<BuildStage, string> = {
  idle: "等待开始",
  validating: "正在校验素材",
  building: "正在塑造形象",
  ready: "已完成",
  failed: "需要重试",
  cancelled: "已取消",
};

function fileName(path: string | null | undefined): string | null {
  if (!path) return null;
  return path.split(/[\\/]/).pop() || path;
}

function isAbortError(caught: unknown): boolean {
  return caught instanceof Error && caught.name === "AbortError";
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
  const [buildResult, setBuildResult] =
    useState<AvatarBuildResult | null>(null);
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
  const abortRef = useRef<AbortController | null>(null);
  const streamSessionRef = useRef<string | null>(null);

  useEffect(
    () => () => {
      if (streamSessionRef.current) {
        void stopAvatarStream(streamSessionRef.current);
      }
    },
    [],
  );
  const canCreate = portraitInfo !== null && recordingInfo !== null;
  const resolvedPortraitPath =
    portraitPath ?? capturedPortraitPath ?? pickedPortraitPath;
  const resolvedRecordingPath =
    recordingPath ?? capturedRecordingPath ?? pickedRecordingPath;
  const buildBusy =
    buildState.stage === "validating" || buildState.stage === "building";
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
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const result = await buildAvatar(
        resolvedPortraitPath,
        resolvedRecordingPath,
        controller.signal,
      );
      if (controller.signal.aborted) {
        setBuildState((current) => cancelBuild(current));
        return;
      }
      setBuildResult(result);
      setBuildState((current) => buildSucceeded(current));
    } catch (caught) {
      if (isAbortError(caught)) {
        setBuildState((current) => cancelBuild(current));
        return;
      }
      setBuildState((current) =>
        buildFailed(current, "头像构建失败，请稍后重试。"),
      );
    } finally {
      abortRef.current = null;
    }
  }

  function handleCancelBuild() {
    abortRef.current?.abort();
    setBuildState((current) => cancelBuild(current));
  }

  function handleRetryBuild() {
    setBuildState((current) => retryBuild(current));
    void handleCreate(true);
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
    if (buildBusy) {
      handleCancelBuild();
    }
    if (streamSessionRef.current) {
      void stopAvatarStream(streamSessionRef.current);
      streamSessionRef.current = null;
    }
    onBack?.();
  }

  async function handleStartConversation() {
    if (!buildResult || !resolvedPortraitPath) return;
    setError(null);
    setStartingConversation(true);
    try {
      const stream = await startAvatarStream(
        buildResult.avatarId,
        buildResult.voiceId,
      );
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
            <button type="button" onClick={handleCancelBuild}>
              取消创建
            </button>
          ) : null}
          {buildState.stage === "failed" ? (
            <button type="button" onClick={handleRetryBuild}>
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
          {buildResult ? (
            <p>
              头像构建完成：{buildResult.voiceId} / {buildResult.avatarId}
            </p>
          ) : null}
          {buildResult && !conversationStarted ? (
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
        <Conversation
          portraitPath={resolvedPortraitPath}
          streamUrl={avatarStream?.streamUrl ?? null}
        />
      ) : null}
    </>
  );
}
