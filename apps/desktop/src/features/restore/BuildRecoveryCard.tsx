import { useEffect, useRef, useState } from "react";

import type { BuildStageName } from "../../api/contracts";
import {
  cancelBuildJob,
  cleanupBuildJob,
  getBuildJob,
  retryBuildJob,
} from "../creation/avatarBuildClient";
import { normalizeJob, type BuildJobSummary } from "./restoreClient";
import "./BuildRecoveryCard.css";

/** Terminal job statuses; polling stops on these. */
const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  "succeeded",
  "failed",
  "cancelled",
  "cleanup_pending",
  "cleanup_failed",
]);

const POLL_INTERVAL_MS = 2000;

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
 * build job API and offers continue / cancel / retry / cleanup actions backed
 * by the server, plus a way to inspect the error detail. Progress is driven by
 * real job state, never by a local timer approximation of the stage.
 */
export default function BuildRecoveryCard({
  job: initialJob,
  onSettled,
}: BuildRecoveryCardProps) {
  const [job, setJob] = useState<BuildJobSummary>(initialJob);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showErrorDetail, setShowErrorDetail] = useState(false);
  const pollTimerRef = useRef<number | null>(null);

  function stopPolling() {
    if (pollTimerRef.current !== null) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }

  function settle(next: BuildJobSummary) {
    if (TERMINAL_STATUSES.has(next.status)) {
      stopPolling();
      onSettled?.(next);
    }
  }

  async function refresh() {
    try {
      const data = await getBuildJob(job.id);
      const next = normalizeJob(data);
      setJob(next);
      settle(next);
    } catch {
      setActionError("无法读取构建进度，请稍后重试。");
    }
  }

  useEffect(() => {
    void refresh();
    pollTimerRef.current = window.setInterval(() => {
      void refresh();
    }, POLL_INTERVAL_MS);
    return stopPolling;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.id]);

  async function runAction(
    key: string,
    action: () => Promise<unknown>,
  ) {
    setBusy(key);
    setActionError(null);
    try {
      await action();
      await refresh();
    } catch {
      setActionError("操作失败，请稍后重试。");
    } finally {
      setBusy(null);
    }
  }

  const canCancel = ["pending", "running", "cleanup_pending"].includes(
    job.status,
  ) && !job.cancelled;
  const canRetry = job.status === "failed";
  const canCleanup = [
    "cancelled",
    "failed",
    "cleanup_pending",
    "cleanup_failed",
  ].includes(job.status);
  const hasError = Boolean(job.errorCode || job.errorDetail);

  return (
    <section className="build-recovery" role="region" aria-label="未完成的形象构建">
      <div className="build-recovery-head">
        <span className="build-recovery-mark" aria-hidden="true" />
        <div>
          <p className="build-recovery-title">检测到未完成的形象构建</p>
          <p className="build-recovery-sub">
            状态：{statusLabels[job.status] ?? job.status} · 更新于{" "}
            {formatTime(job.updatedAt)}
          </p>
        </div>
      </div>

      <dl className="build-recovery-grid">
        <div>
          <dt>当前阶段</dt>
          <dd>{stageLabels[job.stage as BuildStageName] ?? job.stage ?? "—"}</dd>
        </div>
        <div>
          <dt>已完成阶段</dt>
          <dd>
            {job.succeededStages && job.succeededStages.length > 0
              ? ((job.succeededStages as readonly BuildStageName[])
                  .map((stage) => stageLabels[stage] ?? stage)
                  .join("、"))
              : "暂无"}
          </dd>
        </div>
        {job.stageProgress ? (
          <div>
            <dt>阶段进度</dt>
            <dd>{job.stageProgress}</dd>
          </div>
        ) : null}
        {typeof job.retryCount === "number" && job.retryCount > 0 ? (
          <div>
            <dt>重试次数</dt>
            <dd>{job.retryCount}</dd>
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
              {job.errorCode ? `错误码：${job.errorCode}\n` : ""}
              {job.errorDetail ?? "无更多错误信息。"}
            </pre>
          ) : null}
        </div>
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
          onClick={() => void refresh()}
        >
          {busy === "refresh" ? "继续跟踪…" : "继续跟踪"}
        </button>
        {canCancel ? (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() =>
              void runAction("cancel", () => cancelBuildJob(job.id))
            }
          >
            {busy === "cancel" ? "正在取消…" : "取消"}
          </button>
        ) : null}
        {canRetry ? (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() =>
              void runAction("retry", () => retryBuildJob(job.id))
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
              void runAction("cleanup", () => cleanupBuildJob(job.id))
            }
          >
            {busy === "cleanup" ? "正在清理…" : "清理"}
          </button>
        ) : null}
      </div>
    </section>
  );
}