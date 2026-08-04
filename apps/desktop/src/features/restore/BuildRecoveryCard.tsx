import { useState } from "react";

import type { BuildStageName } from "../../api/contracts";
import {
  cancelBuildJob,
  cleanupBuildJob,
  retryBuildJob,
} from "../creation/avatarBuildClient";
import { useBuildJobPolling } from "./useBuildJobPolling";
import type { BuildJobSummary } from "./restoreClient";
import "./BuildRecoveryCard.css";

const stageLabels: Record<BuildStageName, string> = {
  validate_inputs: "校验素材",
  enroll_voice: "注册声音",
  enroll_avatar: "注册形象",
  save_result: "保存结果",
  cleanup: "清理资源",
};

const statusLabels: Record<string, string> = {
  pending: "等待中",
  running: "构建中",
  succeeded: "已完成",
  failed: "失败",
  cancelling: "正在取消",
  cancelled: "已取消",
  cleanup_pending: "清理待处理",
  cleanup_failed: "清理失败",
};

function formatTime(iso: string | null | undefined): string {
  if (!iso) {
    return "未知";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "未知";
  }
  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface BuildRecoveryCardProps {
  readonly job: BuildJobSummary;
  /** Called when the job reaches a terminal state (e.g. succeeded). */
  readonly onSettled?: (job: BuildJobSummary) => void;
}

/**
 * Actionable recovery card for an unfinished build job. It polls the real
 * build job API through the unified `useBuildJobPolling` scheduler and offers
 * continue / cancel / retry / cleanup actions backed by the server, plus a way
 * to inspect and copy diagnostic info. Progress is driven by real job state,
 * never by a local timer approximation of the stage.
 */
export default function BuildRecoveryCard({
  job: initialJob,
  onSettled,
}: BuildRecoveryCardProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showErrorDetail, setShowErrorDetail] = useState(false);
  const [copied, setCopied] = useState(false);

  const {
    job,
    errorKind,
    diagnosis,
    isRetrying,
    retryNow,
    cancel,
    copyDiagnostics,
  } = useBuildJobPolling({
    jobId: initialJob.id,
    initialJob,
    onSettled,
  });

  const currentJob: BuildJobSummary = job ?? initialJob;

  function handleRefresh() {
    setActionError(null);
    retryNow();
  }

  function handleCopyDiagnostics() {
    void copyDiagnostics().then((ok) => {
      setCopied(ok);
      window.setTimeout(() => setCopied(false), 1500);
    });
  }

  async function handleCancel() {
    setBusy("cancel");
    setActionError(null);
    try {
      await cancelBuildJob(currentJob.id);
      // The server is driving the job to `cancelled`; stop the local loop.
      cancel();
    } catch {
      setActionError("取消失败，请稍后重试。");
    } finally {
      setBusy(null);
    }
  }

  async function runAction(
    key: string,
    action: () => Promise<unknown>,
  ) {
    setBusy(key);
    setActionError(null);
    try {
      await action();
      handleRefresh();
    } catch {
      setActionError("操作失败，请稍后重试。");
    } finally {
      setBusy(null);
    }
  }

  const canCancel = ["pending", "running", "cleanup_pending"].includes(
    currentJob.status,
  ) && !currentJob.cancelled;
  const canRetry = currentJob.status === "failed";
  const canCleanup = [
    "cancelled",
    "failed",
    "cleanup_pending",
    "cleanup_failed",
  ].includes(currentJob.status);
  const hasError = Boolean(currentJob.errorCode || currentJob.errorDetail);
  const canCopyDiagnostics = Boolean(diagnosis?.requestId);

  return (
    <section className="build-recovery" role="region" aria-label="未完成的形象构建">
      <div className="build-recovery-head">
        <span className="build-recovery-mark" aria-hidden="true" />
        <div>
          <p className="build-recovery-title">检测到未完成的形象构建</p>
          <p className="build-recovery-sub">
            状态：{statusLabels[currentJob.status] ?? currentJob.status} · 更新于{" "}
            {formatTime(currentJob.updatedAt)}
          </p>
        </div>
      </div>

      {isRetrying ? (
        <p className="build-recovery-retrying" role="status">
          {errorKind === "timeout"
            ? "连接超时，正在重试…"
            : errorKind === "server_failure"
              ? "服务暂时不可用，正在重试…"
              : "连接中断，正在重试…"}
        </p>
      ) : errorKind === "auth" ? (
        <p className="build-recovery-action-error" role="alert">
          鉴权已失效，请重新授权后继续。
        </p>
      ) : null}

      <dl className="build-recovery-grid">
        <div>
          <dt>当前阶段</dt>
          <dd>
            {stageLabels[currentJob.stage as BuildStageName] ??
              currentJob.stage ??
              "—"}
          </dd>
        </div>
        <div>
          <dt>已完成阶段</dt>
          <dd>
            {currentJob.succeededStages &&
            currentJob.succeededStages.length > 0
              ? ((currentJob.succeededStages as readonly BuildStageName[])
                  .map((stage) => stageLabels[stage] ?? stage)
                  .join("、"))
              : "暂无"}
          </dd>
        </div>
        {currentJob.stageProgress ? (
          <div>
            <dt>阶段进度</dt>
            <dd>{currentJob.stageProgress}</dd>
          </div>
        ) : null}
        {typeof currentJob.retryCount === "number" &&
        currentJob.retryCount > 0 ? (
          <div>
            <dt>重试次数</dt>
            <dd>{currentJob.retryCount}</dd>
          </div>
        ) : null}
      </dl>

      {hasError ? (
        <div className="build-recovery-error">
          <button
            type="button"
            className="build-recovery-error-toggle"
            onClick={() => setShowErrorDetail((open) => !open)}
            aria-expanded={showErrorDetail}
          >
            {showErrorDetail ? "收起错误详情" : "查看错误详情"}
          </button>
          {showErrorDetail ? (
            <pre className="build-recovery-error-detail">
              {currentJob.errorCode ? `错误码：${currentJob.errorCode}\n` : ""}
              {currentJob.errorDetail ?? "无更多错误信息。"}
            </pre>
          ) : null}
        </div>
      ) : null}

      {diagnosis?.message ? (
        <p className="build-recovery-action-error" role="alert">
          {diagnosis.message}
        </p>
      ) : null}

      {actionError ? (
        <p className="build-recovery-action-error" role="alert">
          {actionError}
        </p>
      ) : null}

      <div className="build-recovery-actions">
        <button
          type="button"
          disabled={busy !== null}
          onClick={handleRefresh}
        >
          {busy === "refresh" ? "继续检查…" : "继续检查"}
        </button>
        {canCopyDiagnostics ? (
          <button
            type="button"
            disabled={busy !== null}
            onClick={handleCopyDiagnostics}
          >
            {copied ? "已复制" : "复制诊断信息"}
          </button>
        ) : null}
        {canCancel ? (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void handleCancel()}
          >
            {busy === "cancel" ? "正在取消…" : "取消任务"}
          </button>
        ) : null}
        {canRetry ? (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() =>
              void runAction("retry", () => retryBuildJob(currentJob.id))
            }
          >
            {busy === "retry" ? "正在重试…" : "重试"}
          </button>
        ) : null}
        {canCleanup ? (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() =>
              void runAction("cleanup", () => cleanupBuildJob(currentJob.id))
            }
          >
            {busy === "cleanup" ? "正在清理…" : "清理"}
          </button>
        ) : null}
      </div>
    </section>
  );
}