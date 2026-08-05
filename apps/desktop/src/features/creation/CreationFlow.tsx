import { convertFileSrc } from "@tauri-apps/api/core";

import type { DigitalHumanData } from "../../api/contracts";
import ConversationWorkspace from "../conversation/ConversationWorkspace";
import BuildProgress from "./BuildProgress";
import { CreationMode, useCreationWizard } from "./useCreationWizard";
import { CapturePermission } from "./captureClient";

export type { CreationMode } from "./useCreationWizard";

const permissionLabels: Record<CapturePermission, string> = {
  notDetermined: "未确定",
  denied: "已拒绝",
  restricted: "受限",
  authorized: "已允许",
};

interface CreationFlowProps {
  readonly portraitPath?: string;
  readonly recordingPath?: string;
  /**
   * Creation intent. "new" creates a fresh digital human, "rebuild" replaces
   * the remote resources of `rebuildSource` (updating the SAME record),
   * "copy" derives a new digital human from `rebuildSource`'s materials.
   */
  readonly mode?: CreationMode;
  /** The source digital human for rebuild / copy flows. */
  readonly rebuildSource?: DigitalHumanData | null;
  readonly onBack?: () => void;
  readonly onConversationStarted?: () => void;
}

/**
 * The creation wizard. It is a thin renderer: all state, side effects and the
 * build state machine live in `useCreationWizard`, and the build status /
 * progress / recovery actions are delegated to `BuildProgress`.
 */
export default function CreationFlow({
  portraitPath,
  recordingPath,
  mode,
  rebuildSource,
  onBack,
  onConversationStarted,
}: CreationFlowProps) {
  const wizard = useCreationWizard({
    portraitPath,
    recordingPath,
    mode,
    rebuildSource,
    onBack,
    onConversationStarted,
  });

  const {
    rebuildMode,
    copyMode,
    portraitInfo,
    recordingInfo,
    permissions,
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
    handleCreate,
    handleBack,
    handleStartConversation,
    handleCapturePortraitWithState,
    handleCaptureRecordingWithState,
    handlePickPortraitWithState,
    handlePickRecordingWithState,
    handleValidateWithState,
    handleCheckPermissionsWithState,
    handleDeletePortrait,
    handleDeleteRecording,
    handleCancelBuild,
    handleRetryBuild,
  } = wizard;

  return (
    <>
      <section className="studio-status" aria-label="创建数字人">
        <div>
          {onBack ? (
            <button type="button" onClick={handleBack} disabled={buildBusy}>
              返回准备状态
            </button>
          ) : null}
          <p className="studio-status-title">
            {rebuildMode
              ? "重新构建你的数字人"
              : copyMode
                ? "复制你的数字人"
                : "塑造你的数字人"}
          </p>
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
          <BuildProgress
            buildState={buildState}
            buildBusy={buildBusy}
            buildProgressLabel={buildProgressLabel}
            onCancel={() => void handleCancelBuild()}
            onRetry={() => void handleRetryBuild()}
          />
          {portraitLabel ? <p>{portraitLabel}</p> : null}
          {recordingLabel ? <p>{recordingLabel}</p> : null}
          {recordingVoice ? (
            <p role="status">正在录音…</p>
          ) : null}
          {error ? <p role="alert">{error}</p> : null}
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
            {rebuildMode
              ? "重新构建数字人"
              : copyMode
                ? "复制数字人"
                : "创建我的数字人"}
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