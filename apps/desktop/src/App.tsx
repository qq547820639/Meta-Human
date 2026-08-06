import { useEffect, useState } from "react";

import type { DigitalHumanData } from "./api/contracts";
import ConversationWorkspace from "./features/conversation/ConversationWorkspace";
import { useAvatarSession } from "./features/conversation/useAvatarSession";
import CreationFlow, { type CreationMode } from "./features/creation/CreationFlow";
import DigitalHumanManagement from "./features/manage/DigitalHumanManagement";
import ReadinessGate from "./features/readiness/ReadinessGate";
import Settings from "./features/settings/Settings";
import { useReadiness } from "./features/readiness/useReadiness";
import BuildRecoveryCard from "./features/restore/BuildRecoveryCard";
import { isHumanReady } from "./features/restore/restoreClient";
import { useRestoreState } from "./features/restore/useRestoreState";
import {
  DigitalHumanSelectionProvider,
  selectionFromHuman,
  useDigitalHumanSelection,
} from "./features/human/DigitalHumanSelectionContext";

export default function App() {
  return (
    <DigitalHumanSelectionProvider>
      <AppInner />
    </DigitalHumanSelectionProvider>
  );
}

function AppInner() {
  const {
    snapshot,
    error,
    isLoading,
    recommendedAction,
    resume,
  } = useReadiness();
  const restore = useRestoreState();
  const selection = useDigitalHumanSelection();
  const [creationRequested, setCreationRequested] = useState(false);
  const [conversationStarted, setConversationStarted] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [creationMode, setCreationMode] = useState<CreationMode>("new");
  const [rebuildSource, setRebuildSource] =
    useState<DigitalHumanData | null>(null);
  const [restored, setRestored] = useState(false);
  const canRestore = isHumanReady(restore.defaultHuman) && !restore.isLoading;

  useEffect(() => {
    if (canRestore && !restored) {
      setRestored(true);
    }
  }, [canRestore, restored]);

  // Hydrate the shared selection source from the restored default digital
  // human so startup recovery, the conversation page and the management page
  // all observe the same value.
  useEffect(() => {
    if (
      canRestore &&
      restore.defaultHuman !== null &&
      selection.selectedHumanId === null
    ) {
      selection.selectHuman({
        id: restore.defaultHuman.id,
        name: restore.defaultHuman.name,
        portraitPath: restore.defaultHuman.portraitPath ?? null,
        streamUrl: null,
        avatarId: restore.defaultHuman.avatarId ?? null,
        voiceId: restore.defaultHuman.voiceId ?? null,
      });
    }
  }, [canRestore, restore.defaultHuman, selection, selection.selectedHumanId]);

  // Own the live-stream session for the restore / management paths. The
  // selected human's identity drives a real session start (cancellable and
  // bounded); the conversation workspace renders the resulting stream.
  const avatarSession = useAvatarSession({
    avatarId: selection.selected.avatarId,
    voiceId: selection.selected.voiceId,
  });

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
  const heading = restored
    ? "与你的数字人对话"
    : creationRequested
      ? conversationStarted
        ? "与你的数字人对话"
        : creationMode === "rebuild"
          ? "重新构建你的数字人"
          : creationMode === "copy"
            ? "复制你的数字人"
            : "塑造你的数字人"
      : "正在准备工作室";
  const lead = restored
    ? "你的数字人已经准备好，继续聊下去吧。"
    : creationRequested
      ? conversationStarted
        ? "你的数字人已经准备好，继续聊下去吧。"
        : creationMode === "rebuild"
          ? "用新的照片和声音，重新塑造你的数字人。"
          : creationMode === "copy"
            ? "基于现有数字人，创建一份新的副本。"
            : "用一张照片和一段声音，准备第一次自然的回应。"
      : "我们先安静地确认对话、声音与知识，让第一次见面真正自然。";
  const assurance = restored
    ? "对话与记忆只保存在这台电脑上。"
    : creationRequested
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
          <button
            type="button"
            onClick={() => {
              setManageOpen((open) => !open);
              setSettingsOpen(false);
            }}
          >
            {manageOpen ? "关闭管理" : "我的数字人"}
          </button>
          <button
            type="button"
            onClick={() => {
              setSettingsOpen((open) => !open);
              setManageOpen(false);
            }}
          >
            {settingsOpen ? "关闭设置" : "设置"}
          </button>
        </header>

        {manageOpen ? (
          <DigitalHumanManagement
            onSelectHuman={(human) => {
              if (human === null) {
                selection.clearSelection();
              } else {
                selection.selectHuman(selectionFromHuman(human));
              }
            }}
            onRebuild={(human) => {
              setRebuildSource(human);
              setCreationMode("rebuild");
              setManageOpen(false);
              setCreationRequested(true);
            }}
            onCopy={(human) => {
              setRebuildSource(human);
              setCreationMode("copy");
              setManageOpen(false);
              setCreationRequested(true);
            }}
          />
        ) : null}

        {settingsOpen ? (
          <Settings onSettingsApplied={() => resume()} />
        ) : null}

        {!settingsOpen && !manageOpen && restore.resumableJob && !restored ? (
          <BuildRecoveryCard
            job={restore.resumableJob}
            onSettled={() => {
              void restore.retry();
            }}
          />
        ) : null}

        {!settingsOpen && !manageOpen && restored ? (
          <ConversationWorkspace
            portraitPath={
              selection.selected.portraitPath ??
              restore.defaultHuman?.portraitPath ??
              null
            }
            session={avatarSession.session}
            humanName={selection.selected.name}
            humanId={selection.selected.id}
            initialConversationId={restore.recentConversation?.id ?? null}
          />
        ) : null}

        {!settingsOpen && !manageOpen && snapshot && !creationRequested && !restored ? (
          <ReadinessGate
            snapshot={snapshot}
            recommendedAction={recoveryAction}
            privacyNote={privacyNote}
            onResume={recoveryAction ? resume : undefined}
            onOpenSettings={() => setSettingsOpen(true)}
            onCreate={() => setCreationRequested(true)}
          />
        ) : null}

        {!settingsOpen && !manageOpen && !snapshot && isLoading && !error && !restored ? (
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

        {!settingsOpen && !manageOpen && !snapshot && error && !restored ? (
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

        {!settingsOpen && !manageOpen && creationRequested && !restored ? (
          <CreationFlow
            mode={creationMode}
            rebuildSource={rebuildSource}
            onBack={() => {
              setCreationRequested(false);
              setRebuildSource(null);
              setCreationMode("new");
            }}
            onConversationStarted={() => setConversationStarted(true)}
          />
        ) : null}
      </main>
    </div>
  );
}