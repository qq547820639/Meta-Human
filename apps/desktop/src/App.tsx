import { useState } from "react";

import CreationFlow from "./features/creation/CreationFlow";
import ReadinessGate from "./features/readiness/ReadinessGate";
import Settings from "./features/settings/Settings";
import { useReadiness } from "./features/readiness/useReadiness";

export default function App() {
  const {
    snapshot,
    error,
    isLoading,
    recommendedAction,
    resume,
  } = useReadiness();
  const [creationRequested, setCreationRequested] = useState(false);
  const [conversationStarted, setConversationStarted] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const needsUserHelp =
    snapshot !== null &&
    !snapshot.canCreate &&
    snapshot.requirements.some(
      (requirement) => requirement.state === "needsAction",
    );
  const isFatalError = error?.code === "readiness_failed_closed";
  const privacyNote =
    snapshot?.requirements.some(
      (requirement) =>
        requirement.id === "voicePresence" &&
        requirement.state === "needsAction",
    )
      ? "声音和形象只会发送到你选择的服务。"
      : null;
  const recoveryAction =
    recommendedAction ??
    (needsUserHelp
      ? "请重新确认准备状态。"
      : error
        ? "请稍后重新确认准备状态。"
        : null);
  const heading = creationRequested
    ? conversationStarted
      ? "与你的数字人对话"
      : "塑造你的数字人"
    : "正在准备工作室";
  const lead = creationRequested
    ? conversationStarted
      ? "你的数字人已经准备好，继续聊下去吧。"
      : "用一张照片和一段声音，准备第一次自然的回应。"
    : "我们先安静地确认对话、声音与知识，让第一次见面真正自然。";
  const assurance = creationRequested
    ? conversationStarted
      ? "对话与记忆只保存在这台电脑上。"
      : "你的素材只用于创建这个数字人。"
    : "准备过程由应用管理，技术信息默认收起。";

  return (
    <div className="studio-app">
      <main className="studio-shell">
        <header className="studio-intro">
          <p className="studio-wordmark">私人数字人工作室</p>
          <div className="studio-presence" aria-hidden="true">
            <span />
          </div>
          <h1>{heading}</h1>
          <p className="studio-lead">{lead}</p>
          <p className="studio-assurance">{assurance}</p>
          <button type="button" onClick={() => setSettingsOpen((open) => !open)}>
            {settingsOpen ? "关闭设置" : "设置"}
          </button>
        </header>

        {settingsOpen ? (
          <Settings onSettingsApplied={() => resume()} />
        ) : null}

        {!settingsOpen && snapshot && !creationRequested ? (
          <ReadinessGate
            snapshot={snapshot}
            recommendedAction={recoveryAction}
            privacyNote={privacyNote}
            onResume={recoveryAction ? resume : undefined}
            onOpenSettings={() => setSettingsOpen(true)}
            onCreate={() => setCreationRequested(true)}
          />
        ) : null}

        {!settingsOpen && !snapshot && isLoading && !error ? (
          <section className="studio-status" aria-label="正在载入准备状态">
            <span className="studio-status-mark" aria-hidden="true" />
            <div>
              <p className="studio-status-title" role="status">
                正在确认工作室是否准备就绪…
              </p>
              <p>应用正在读取真实状态，不会提前解锁创作。</p>
            </div>
          </section>
        ) : null}

        {!settingsOpen && !snapshot && error ? (
          <section className="studio-status studio-status-error" role="alert">
            <span className="studio-status-mark" aria-hidden="true">
              !
            </span>
            <div>
              <p className="studio-status-title">暂时无法确认准备状态</p>
              <p>
                {isFatalError
                  ? "准备服务已停止，请重新打开应用。"
                  : "工作室没有被误报为就绪。你可以安全地重新确认。"}
              </p>
              {isFatalError ? null : (
                <button type="button" onClick={resume}>
                  重新确认准备状态
                </button>
              )}
            </div>
          </section>
        ) : null}

        {!settingsOpen && creationRequested ? (
          <CreationFlow
            onBack={() => setCreationRequested(false)}
            onConversationStarted={() => setConversationStarted(true)}
          />
        ) : null}
      </main>
    </div>
  );
}
