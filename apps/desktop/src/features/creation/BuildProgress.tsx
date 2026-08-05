import type { AvatarBuildState } from "./avatarBuild";
import { buildStageLabels } from "./useCreationWizard";

interface BuildProgressProps {
  readonly buildState: AvatarBuildState;
  readonly buildBusy: boolean;
  readonly buildProgressLabel: string | null;
  readonly onCancel: () => void;
  readonly onRetry: () => void;
}

/**
 * Renders the build state machine as a plain text status line plus the
 * stage-specific messages and actions (cancelling / retrying). It never fakes
 * progress — every label is derived either from the authoritative backend job
 * snapshot or from the local build state machine.
 */
export default function BuildProgress({
  buildState,
  buildBusy,
  buildProgressLabel,
  onCancel,
  onRetry,
}: BuildProgressProps) {
  return (
    <>
      <p>构建状态：{buildStageLabels[buildState.stage]}</p>
      {buildProgressLabel ? <p>{buildProgressLabel}</p> : null}
      {buildState.stage === "failed" ? (
        <p role="alert">{buildState.error}</p>
      ) : null}
      {buildState.stage === "cancelled" ? (
        <p>已取消创建，可以重新开始。</p>
      ) : null}
      {buildBusy ? (
        <p role="status">正在塑造你的数字人，请稍候…</p>
      ) : null}
      {buildBusy ? (
        <button type="button" onClick={onCancel}>
          取消创建
        </button>
      ) : null}
      {buildState.stage === "failed" ? (
        <button type="button" onClick={onRetry}>
          重试创建
        </button>
      ) : null}
    </>
  );
}