import SettingsPanel from "../settings/SettingsPanel";
import { useUpdateManager } from "./useUpdateManager";
import { downloadProgress, updateStatusLabel } from "./updateStateMachine";

/**
 * 「检查更新」入口与状态展示。
 *
 * 当更新端点 / 签名公钥未配置时，如实展示「未配置」且不提供可用的下载/安装动作，
 * 绝不假装可以更新。签名验证是硬性门槛：签名未验证通过前不会出现「安装」按钮。
 */
export default function UpdatePanel() {
  const manager = useUpdateManager();
  const { state, configured, running } = manager;
  const progress = downloadProgress(state);

  return (
    <SettingsPanel title="应用更新">
      <section aria-label="更新状态">
        <p>当前版本：{state.currentVersion || "读取中…"}</p>
        <p>
          更新通道：
          <button
            type="button"
            onClick={() => manager.setChannel("stable")}
            disabled={running || !configured}
            aria-pressed={state.channel === "stable"}
          >
            稳定
          </button>
          <button
            type="button"
            onClick={() => manager.setChannel("beta")}
            disabled={running || !configured}
            aria-pressed={state.channel === "beta"}
          >
            测试
          </button>
        </p>

        {!configured ? (
          <p role="status">
            更新未配置：缺少更新端点与签名公钥，应用内更新不可用（UNVERIFIED）。
          </p>
        ) : null}

        {state.availableVersion ? (
          <p>可用版本：{state.availableVersion}</p>
        ) : null}

        <p role="status">{updateStatusLabel(state)}</p>

        {state.phase === "downloading" && progress !== null ? (
          <progress value={state.downloadedBytes} max={state.totalBytes} aria-label="下载进度">
            {(progress * 100).toFixed(0)}%
          </progress>
        ) : null}

        {state.phase === "verifying_signature" ? (
          <p>正在使用内置公钥验证更新包签名，未通过验证不会安装。</p>
        ) : null}

        {state.phase === "ready" ? (
          <p>签名已验证{state.backupMade ? "，数据库已备份" : ""}。</p>
        ) : null}

        {state.error ? (
          <p role="alert">
            更新失败（{state.error.kind}）：{state.error.message}
          </p>
        ) : null}

        {state.phase === "rolled_back" ? (
          <p>已回滚到当前版本，原数据库备份保留。</p>
        ) : null}
      </section>

      <section aria-label="更新操作">
        <button
          type="button"
          onClick={() => void manager.check()}
          disabled={running || !configured}
        >
          {state.phase === "checking" ? "检查中…" : "检查更新"}
        </button>

        {state.phase === "available" ? (
          <button type="button" onClick={() => void manager.downloadAndVerify()}>
            下载并验证
          </button>
        ) : null}

        {state.phase === "downloading" ? (
          <button type="button" onClick={() => void manager.downloadAndVerify()} disabled>
            下载中…
          </button>
        ) : null}

        {state.phase === "verifying_signature" ? (
          <button type="button" disabled>
            验证签名中…
          </button>
        ) : null}

        {state.phase === "ready" ? (
          <button type="button" onClick={() => void manager.install()}>
            安装更新
          </button>
        ) : null}

        {state.phase === "installing" ? (
          <button type="button" disabled>
            安装中…
          </button>
        ) : null}

        {state.phase === "error" ? (
          <>
            <button type="button" onClick={() => manager.retry()}>
              重试
            </button>
            <button type="button" onClick={() => manager.rollback()}>
              回滚到当前版本
            </button>
          </>
        ) : null}

        <button type="button" onClick={() => manager.reset()} disabled={running}>
          重置更新状态
        </button>
      </section>
    </SettingsPanel>
  );
}