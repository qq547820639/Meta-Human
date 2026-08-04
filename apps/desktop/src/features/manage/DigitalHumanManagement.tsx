import { useCallback, useEffect, useState } from "react";

import { ApiError } from "../../api/client";
import type { BuildJobData, DigitalHumanData } from "../../api/contracts";
import {
  cleanupBuildJob,
  deleteHuman,
  getRecentBuildJob,
  listHumans,
  renameHuman,
  retryBuildJob,
  setDefaultHuman,
} from "../creation/avatarBuildClient";

/**
 * Digital-human management panel ("我的数字人").
 *
 * It lists every digital human, shows the current default, lets the user switch
 * the default, rename a human, inspect creation / remote status and failure
 * reasons, retry / clean up a failed build job, and delete a human.
 *
 * All requests go through the unified `apiRequest` client; failures surface as
 * `ApiError` and are shown to the user (never swallowed, never destructured
 * away).
 *
 * Delete semantics (honest about remote resources):
 * - When the human has no remote resources, deleting the human only removes the
 *   local record.
 * - When the human has remote resources, the user is asked to resolve the
 *   remote cleanup first. The result reports exactly what happened: local
 *   delete success, remote delete success, provider unsupported, remote cleanup
 *   pending, or remote cleanup failed (retryable). We never claim "远程资源已清理"
 *   unless a remote cleanup interface was actually invoked and succeeded.
 */

export interface DigitalHumanManagementProps {
  /** Fired with the selected digital human id when the default is switched. */
  readonly onSelectHuman?: (humanId: string) => void;
  /** Fired when the user asks to rebuild (re-record voice / re-create avatar). */
  readonly onRebuild?: (human: DigitalHumanData) => void;
}

/** Outcome of the remote-resource part of a delete. */
export type DeleteRemoteOutcome =
  | { readonly kind: "cleaned" } // 远程删除成功
  | { readonly kind: "pending" } // 远程清理待处理
  | { readonly kind: "failed" } // 远程清理失败（可再重试）
  | { readonly kind: "unsupported" } // Provider 不支持远程删除
  | { readonly kind: "none" }; // 无远程资源

export interface DeleteHumanResult {
  readonly localDeleted: boolean;
  readonly humanId: string;
  readonly remote: DeleteRemoteOutcome;
}

export type DeleteCleanupChoice = "skip" | "cleanup";

/** True when a human has remote resources that may need cleanup on delete. */
export function hasRemoteResources(human: DigitalHumanData): boolean {
  return Boolean(
    human.avatar_id ||
      human.voice_id ||
      (human.remote_status !== null &&
        human.remote_status.trim() !== ""),
  );
}

/** Human-readable label for a remote-outcome result. */
export function remoteOutcomeLabel(outcome: DeleteRemoteOutcome): string {
  switch (outcome.kind) {
    case "cleaned":
      return "远程删除成功";
    case "pending":
      return "远程清理待处理";
    case "failed":
      return "远程清理失败";
    case "unsupported":
      return "Provider 不支持远程删除";
    case "none":
      return "无远程资源";
  }
}

/**
 * Deletes a digital human, resolving remote resources first when they exist.
 *
 * - No remote resources: only the local record is deleted.
 * - `choice === "cleanup"` with an associated build job: the remote cleanup
 *   interface is invoked first; the outcome determines whether the local record
 *   is deleted. A failed cleanup leaves the local record in place so the user
 *   can retry.
 * - `choice === "cleanup"` without an associated job: the provider offers no
 *   remote delete for the human, so only the local record is deleted.
 * - `choice === "skip"`: the local record is deleted and remote cleanup is left
 *   pending (never reported as cleaned).
 */
export async function deleteDigitalHumanWithCleanup(
  human: DigitalHumanData,
  job: BuildJobData | null,
  choice: DeleteCleanupChoice,
): Promise<DeleteHumanResult> {
  if (!hasRemoteResources(human)) {
    await deleteHuman(human.id);
    return { localDeleted: true, humanId: human.id, remote: { kind: "none" } };
  }

  const associatedJob =
    job !== null && job.digital_human_id === human.id ? job : null;

  if (choice === "cleanup") {
    if (associatedJob === null) {
      // No remote delete interface is available for this human.
      await deleteHuman(human.id);
      return {
        localDeleted: true,
        humanId: human.id,
        remote: { kind: "unsupported" },
      };
    }
    let outcome: DeleteRemoteOutcome;
    try {
      const cleaned = await cleanupBuildJob(associatedJob.id);
      if (cleaned.status === "cleanup_failed") {
        outcome = { kind: "failed" };
      } else if (cleaned.status === "cleanup_pending") {
        outcome = { kind: "pending" };
      } else {
        outcome = { kind: "cleaned" };
      }
    } catch {
      outcome = { kind: "failed" };
    }
    if (outcome.kind === "failed") {
      // Keep the local record so the user can retry cleanup.
      return { localDeleted: false, humanId: human.id, remote: outcome };
    }
    await deleteHuman(human.id);
    return { localDeleted: true, humanId: human.id, remote: outcome };
  }

  // skip: delete locally only, remote cleanup stays pending.
  await deleteHuman(human.id);
  return {
    localDeleted: true,
    humanId: human.id,
    remote: { kind: "pending" },
  };
}

function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    return err.recommendedAction ?? err.message;
  }
  return "请求失败，请稍后重试。";
}

function creationStatusLabel(status: string): string {
  switch (status) {
    case "pending":
      return "待处理";
    case "building":
      return "构建中";
    case "ready":
      return "已就绪";
    case "failed":
      return "失败";
    case "cancelled":
      return "已取消";
    default:
      return status;
  }
}

export default function DigitalHumanManagement({
  onSelectHuman,
  onRebuild,
}: DigitalHumanManagementProps) {
  const [humans, setHumans] = useState<DigitalHumanData[]>([]);
  const [recentJob, setRecentJob] = useState<BuildJobData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  // Delete dialog state.
  const [deleteTarget, setDeleteTarget] = useState<DigitalHumanData | null>(
    null,
  );
  const [deleteJob, setDeleteJob] = useState<BuildJobData | null>(null);
  const [deleteResult, setDeleteResult] = useState<DeleteHumanResult | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [humansResponse, job] = await Promise.all([
        listHumans(),
        getRecentBuildJob(),
      ]);
      setHumans(humansResponse);
      setRecentJob(job);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function associatedJob(human: DigitalHumanData): BuildJobData | null {
    return recentJob !== null && recentJob.digital_human_id === human.id
      ? recentJob
      : null;
  }

  async function handleSetDefault(human: DigitalHumanData) {
    setBusyId(human.id);
    setError(null);
    setStatus(null);
    try {
      const updated = await setDefaultHuman(human.id);
      setHumans((list) =>
        list.map((item) => ({ ...item, is_default: item.id === updated.id })),
      );
      setStatus(`已设为默认数字人：${updated.name}`);
      onSelectHuman?.(updated.id);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusyId(null);
    }
  }

  async function handleRename(human: DigitalHumanData) {
    const name = renameValue.trim();
    if (!name) return;
    setBusyId(human.id);
    setError(null);
    setStatus(null);
    try {
      const updated = await renameHuman(human.id, name);
      setHumans((list) =>
        list.map((item) => (item.id === human.id ? updated : item)),
      );
      setRenamingId(null);
      setRenameValue("");
      setStatus(`名称已更新：${updated.name}`);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusyId(null);
    }
  }

  function openDelete(human: DigitalHumanData) {
    setDeleteResult(null);
    setDeleteTarget(human);
    setDeleteJob(associatedJob(human));
  }

  async function confirmDelete(choice: DeleteCleanupChoice) {
    if (deleteTarget === null) return;
    setDeleting(true);
    setError(null);
    setStatus(null);
    try {
      const result = await deleteDigitalHumanWithCleanup(
        deleteTarget,
        deleteJob,
        choice,
      );
      setDeleteResult(result);
      if (result.localDeleted) {
        const wasDefault = deleteTarget.is_default;
        setHumans((list) => list.filter((item) => item.id !== deleteTarget.id));
        if (wasDefault) {
          onSelectHuman?.("");
        }
      }
    } catch (err) {
      setError(describeError(err));
    } finally {
      setDeleting(false);
    }
  }

  function closeDelete() {
    setDeleteTarget(null);
    setDeleteJob(null);
    setDeleteResult(null);
  }

  async function handleRetry(human: DigitalHumanData) {
    const job = associatedJob(human);
    if (job === null) return;
    setBusyId(human.id);
    setError(null);
    setStatus(null);
    try {
      const updated = await retryBuildJob(job.id);
      setStatus(`已重新提交构建任务（${updated.id}）。`);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusyId(null);
    }
  }

  async function handleCleanup(human: DigitalHumanData) {
    const job = associatedJob(human);
    if (job === null) return;
    setBusyId(human.id);
    setError(null);
    setStatus(null);
    try {
      const updated = await cleanupBuildJob(job.id);
      setStatus(`已提交远程清理任务（${updated.id}）。`);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusyId(null);
    }
  }

  const deleteNeedsRemote = deleteTarget !== null && hasRemoteResources(deleteTarget);

  return (
    <section className="studio-status" aria-label="我的数字人">
      <div>
        <p className="studio-status-title">我的数字人</p>
        <button type="button" onClick={() => void load()} disabled={loading}>
          {loading ? "刷新中…" : "刷新"}
        </button>

        {loading ? (
          <p role="status">正在读取数字人…</p>
        ) : null}
        {error ? <p role="alert">{error}</p> : null}
        {status ? <p role="status">{status}</p> : null}

        {!loading && humans.length === 0 ? (
          <p>还没有数字人。</p>
        ) : (
          <ul aria-label="数字人列表">
            {humans.map((human) => {
              const job = associatedJob(human);
              const remote = hasRemoteResources(human);
              const isBusy = busyId === human.id;
              return (
                <li key={human.id}>
                  <p>
                    {human.name}
                    {human.is_default ? <span>（默认）</span> : null}
                  </p>
                  <p>
                    创建状态：{creationStatusLabel(human.creation_status)}
                    {human.creation_progress
                      ? `（${human.creation_progress}）`
                      : null}
                  </p>
                  <p>远程状态：{remote ? human.remote_status ?? "已关联" : "无"}</p>
                  {human.error ? <p role="alert">失败原因：{human.error}</p> : null}
                  {job?.error_detail ? (
                    <p role="alert">任务详情：{job.error_detail}</p>
                  ) : null}

                  {!human.is_default ? (
                    <button
                      type="button"
                      onClick={() => void handleSetDefault(human)}
                      disabled={isBusy}
                    >
                      {isBusy ? "处理中…" : "设为默认"}
                    </button>
                  ) : null}

                  {renamingId === human.id ? (
                    <label>
                      新名称
                      <input
                        value={renameValue}
                        onChange={(event) => setRenameValue(event.target.value)}
                      />
                    </label>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      if (renamingId === human.id) {
                        void handleRename(human);
                      } else {
                        setRenamingId(human.id);
                        setRenameValue(human.name);
                      }
                    }}
                    disabled={isBusy}
                  >
                    {renamingId === human.id ? "保存名称" : "改名"}
                  </button>

                  {job !== null && human.creation_status === "failed" ? (
                    <>
                      <button
                        type="button"
                        onClick={() => void handleRetry(human)}
                        disabled={isBusy}
                      >
                        重试构建
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleCleanup(human)}
                        disabled={isBusy}
                      >
                        清理失败资源
                      </button>
                    </>
                  ) : null}

                  <button
                    type="button"
                    onClick={() => onRebuild?.(human)}
                    disabled={isBusy}
                  >
                    重新构建
                  </button>

                  <button
                    type="button"
                    onClick={() => openDelete(human)}
                    disabled={isBusy}
                  >
                    删除
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {deleteTarget !== null ? (
          <div role="dialog" aria-label="删除数字人">
            <p>删除数字人：{deleteTarget.name}</p>
            {deleteResult !== null ? (
              <>
                <p role="status">
                  {deleteResult.localDeleted ? "本地删除成功" : "本地删除未完成"}
                  {"，"}
                  {remoteOutcomeLabel(deleteResult.remote)}
                  {deleteResult.remote.kind === "failed" ? "（可再重试清理）" : null}
                </p>
                <button type="button" onClick={closeDelete}>
                  关闭
                </button>
              </>
            ) : (
              <>
                {deleteNeedsRemote ? (
                  <p role="alert">
                    该数字人关联了远程资源。删除本地记录前请先处理远程资源。
                  </p>
                ) : (
                  <p>确认删除该数字人的本地记录？</p>
                )}
                {deleteNeedsRemote && deleteJob !== null ? (
                  <button
                    type="button"
                    onClick={() => void confirmDelete("cleanup")}
                    disabled={deleting}
                  >
                    {deleting ? "处理中…" : "清理远程资源并删除"}
                  </button>
                ) : null}
                {deleteNeedsRemote && deleteJob === null ? (
                  <p role="alert">Provider 不支持远程删除。</p>
                ) : null}
                {deleteNeedsRemote ? (
                  <button
                    type="button"
                    onClick={() => void confirmDelete("skip")}
                    disabled={deleting}
                  >
                    {deleting ? "处理中…" : "跳过远程清理，仅删除本地记录"}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void confirmDelete("skip")}
                    disabled={deleting}
                  >
                    {deleting ? "处理中…" : "删除"}
                  </button>
                )}
                <button type="button" onClick={closeDelete} disabled={deleting}>
                  取消
                </button>
              </>
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
}