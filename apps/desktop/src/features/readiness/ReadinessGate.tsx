import "./ReadinessGate.css";

import type {
  ReadinessRequirementId,
  ReadinessSnapshot,
  ReadinessState,
} from "./types";

interface ReadinessGateProps {
  readonly snapshot: ReadinessSnapshot;
  readonly recommendedAction?: string | null;
  readonly privacyNote?: string | null;
  readonly onResume?: () => void;
  readonly onOpenSettings?: () => void;
  readonly onCreate?: () => void;
}

const requirementCopy: Record<
  ReadinessRequirementId,
  { label: string; description: string }
> = {
  conversation: {
    label: "能够对话",
    description: "确认提问与回答可以完整进行",
  },
  voicePresence: {
    label: "能够听说和呈现",
    description: "确认聆听、发声与画面呈现",
  },
  knowledge: {
    label: "能够使用知识",
    description: "确认知识可以读取并用于回答",
  },
};

const stateCopy: Record<ReadinessState, { label: string; mark: string }> = {
  notStarted: { label: "等待准备", mark: "○" },
  checking: { label: "正在确认", mark: "…" },
  passed: { label: "已准备好", mark: "✓" },
  needsAction: { label: "需要你的帮助", mark: "!" },
};

function getSummary(snapshot: ReadinessSnapshot): string {
  if (snapshot.canCreate) {
    return "工作室已经准备好，可以开始塑造你的数字人。";
  }

  if (
    snapshot.requirements.some(
      (requirement) => requirement.state === "needsAction",
    )
  ) {
    return "有些准备需要你的帮助，处理好后即可继续。";
  }

  if (
    snapshot.requirements.some(
      (requirement) => requirement.state === "checking",
    )
  ) {
    return "工作室正在逐项确认，全部准备好后即可开始。";
  }

  return "准备尚未开始，应用会先确认每一项能力。";
}

export default function ReadinessGate({
  snapshot,
  recommendedAction,
  privacyNote,
  onResume,
  onOpenSettings,
  onCreate,
}: ReadinessGateProps) {
  const canStartCreation = snapshot.canCreate && onCreate !== undefined;
  const needsUserHelp = snapshot.requirements.some(
    (requirement) => requirement.state === "needsAction",
  );
  const passedCount = snapshot.requirements.filter(
    (requirement) => requirement.state === "passed",
  ).length;

  return (
    <section className="readiness-gate" aria-labelledby="readiness-title">
      <header className="readiness-heading">
        <p className="readiness-kicker">开始创作之前</p>
        <h2 id="readiness-title">让第一次回应自然发生</h2>
        <p className="readiness-summary" id="readiness-summary" aria-live="polite">
          {getSummary(snapshot)}
        </p>
        {!snapshot.canCreate ? (
          <p className="readiness-progress">
            准备进度：{passedCount}/{snapshot.requirements.length}
          </p>
        ) : null}
      </header>

      <ol className="readiness-list" aria-label="工作室准备状态">
        {snapshot.requirements.map((requirement) => {
          const content = requirementCopy[requirement.id];
          const state = stateCopy[requirement.state];

          return (
            <li
              className="readiness-item"
              data-state={requirement.state}
              key={requirement.id}
            >
              <span className="readiness-mark" aria-hidden="true">
                {state.mark}
              </span>
              <span className="readiness-copy">
                <strong>{content.label}</strong>
                <span>{content.description}</span>
              </span>
              <span className="readiness-state">{state.label}</span>
            </li>
          );
        })}
      </ol>

      {recommendedAction ? (
        <aside className="readiness-recovery" aria-label="建议的恢复操作">
          <p>{recommendedAction}</p>
          {onResume ? (
            <button type="button" onClick={onResume}>
              重新确认准备状态
            </button>
          ) : null}
          {needsUserHelp && onOpenSettings ? (
            <button type="button" onClick={onOpenSettings}>
              去设置
            </button>
          ) : null}
        </aside>
      ) : null}

      {privacyNote ? (
        <p className="readiness-privacy">{privacyNote}</p>
      ) : null}

      <details className="readiness-details">
        <summary>技术详情</summary>
        <div className="readiness-details-content">
          <p>这些信息只用于排查问题，不影响你的创作选择。</p>
          <dl>
            {snapshot.requirements.map((requirement) => (
              <div key={requirement.id}>
                <dt>{requirementCopy[requirement.id].label}</dt>
                <dd>
                  {stateCopy[requirement.state].label} ·{" "}
                  {requirement.required ? "必需" : "可选"}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </details>

      <footer className="readiness-action">
        <p id="creation-note">
          {snapshot.canCreate
            ? "一切就绪，你可以从一张喜欢的照片开始。"
            : "三项都准备好后，这里会自动解锁。"}
        </p>
        <button
          type="button"
          className="primary-action"
          aria-describedby="creation-note"
          disabled={!canStartCreation}
          onClick={onCreate}
        >
          <span>创建我的数字人</span>
          <span aria-hidden="true">→</span>
        </button>
      </footer>
    </section>
  );
}
