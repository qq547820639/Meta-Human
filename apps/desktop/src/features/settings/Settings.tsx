import { useEffect, useRef, useState } from "react";

import {
  AppSettings,
  AppSettingsView,
  SecretFlags,
  loadAppSettings,
  resetAllSettings,
  restartSidecar,
  saveAppSettings,
} from "./settingsClient";
import type { SecretKind } from "./settingsClient";
import { KnowledgeSource, listKnowledgeSources } from "../knowledge/knowledgeClient";
import { clearAllLocalData } from "../privacy/privacyClient";
import { deleteCapturedTempMedia } from "../creation/captureClient";
import {
  deleteKnowledgeSource,
  resyncKnowledgeSource,
  setKnowledgeSourceEnabled,
} from "../knowledge/knowledgeClient";
import LocalModelPanel from "./LocalModelPanel";
import RemoteServicePanel from "./RemoteServicePanel";
import FeishuKnowledgePanel from "./FeishuKnowledgePanel";
import ServiceStatusPanel from "./ServiceStatusPanel";
import MemoryPanel from "./MemoryPanel";
import PrivacyPanel from "./PrivacyPanel";
import MyDigitalHumanPanel from "./MyDigitalHumanPanel";
import AdvancedPanel from "./AdvancedPanel";
import DiagnosticsPanel from "../diagnostics/DiagnosticsPanel";
import UpdatePanel from "../update/UpdatePanel";
import DataScopeCard from "./DataScopeCard";
import { probeLocalServices } from "./localProbe";
import { validateModelCapability } from "./modelCapability";
import { translateServiceError } from "./errorTranslation";

const emptySettings: AppSettings = {
  localBaseUrl: "",
  localChatModel: "",
  localEmbeddingModel: "",
  localSttModel: "",
  localTimeoutSeconds: 5,
  remoteBaseUrl: "",
  remoteTtsVoice: "",
  remoteVoiceEnrollPath: "",
  remoteAvatarEnrollPath: "",
  remoteAvatarStreamPath: "",
  remoteAvatarStreamStopPath: "",
  remoteTtsPath: "",
  feishuAppId: "",
  feishuSpaceId: "",
  feishuBaseUrl: "",
};

const emptySecretFlags: SecretFlags = {
  remoteApiKeySet: false,
  feishuAppSecretSet: false,
  feishuAccessTokenSet: false,
  feishuRefreshTokenSet: false,
};

/** Per-section validation. Returns a list of human-readable problems. */
function validateSettings(
  settings: AppSettings,
  availableModels: readonly string[] = [],
): string[] {
  const errors: string[] = [];
  const urlFields: Array<[keyof AppSettings, string]> = [
    ["localBaseUrl", "本地服务地址"],
    ["remoteBaseUrl", "远程服务地址"],
    ["feishuBaseUrl", "飞书服务地址"],
  ];
  for (const [field, label] of urlFields) {
    const value = (settings[field] ?? "") as string;
    if (value.trim() && !/^https?:\/\//i.test(value.trim())) {
      errors.push(`${label}必须以 http:// 或 https:// 开头。`);
    }
  }
  const timeout = settings.localTimeoutSeconds;
  if (typeof timeout === "number" && (timeout < 1 || timeout > 600)) {
    errors.push("超时秒数必须在 1–600 之间。");
  }
  const localConfigured = Boolean((settings.localBaseUrl ?? "").trim());
  if (localConfigured) {
    if (!(settings.localChatModel ?? "").trim()) {
      errors.push("本地对话模型未选择。");
    }
    if (!(settings.localEmbeddingModel ?? "").trim()) {
      errors.push("本地嵌入模型未选择。");
    }
  }
  if (availableModels.length > 0) {
    const modelRoles: Array<[keyof AppSettings, string]> = [
      ["localChatModel", "对话"],
      ["localEmbeddingModel", "嵌入"],
      ["localSttModel", "语音识别"],
    ];
    for (const [field, roleLabel] of modelRoles) {
      const value = (settings[field] as string | null | undefined) ?? "";
      if (value.trim() && !availableModels.includes(value.trim())) {
        errors.push(
          `${roleLabel}模型“${value.trim()}”不在检测到的模型列表中，请重新选择。`,
        );
      }
    }
  }
  return errors;
}

interface SettingsProps {
  readonly onSettingsApplied?: () => void;
}

export default function Settings({ onSettingsApplied }: SettingsProps) {
  const [settings, setSettings] = useState<AppSettings>(emptySettings);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  // The last snapshot that was successfully loaded or saved; used to detect
  // dirty state and to roll back the form when a save fails.
  const [savedSettings, setSavedSettings] =
    useState<AppSettings>(emptySettings);
  const [secretFlags, setSecretFlags] = useState<SecretFlags>(emptySecretFlags);
  const [remoteApiKey, setRemoteApiKey] = useState("");
  const [feishuAppSecret, setFeishuAppSecret] = useState("");
  const [feishuAccessToken, setFeishuAccessToken] = useState("");
  const [feishuRefreshToken, setFeishuRefreshToken] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [knowledgeSources, setKnowledgeSources] = useState<KnowledgeSource[]>(
    [],
  );
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [sourcesError, setSourcesError] = useState<string | null>(null);
  const [discoveredModels, setDiscoveredModels] = useState<string[]>([]);
  const [postSaveVerify, setPostSaveVerify] = useState<string | null>(null);
  const activeRef = useRef(true);

  useEffect(() => {
    return () => {
      activeRef.current = false;
    };
  }, []);
  const [confirmingSourceId, setConfirmingSourceId] = useState<string | null>(
    null,
  );
  const [confirmingClearAll, setConfirmingClearAll] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);

  useEffect(() => {
    let active = true;
    loadAppSettings()
      .then((view: AppSettingsView) => {
        if (!active) return;
        setSettings({ ...emptySettings, ...view.settings });
        setSavedSettings({ ...emptySettings, ...view.settings });
        setSecretFlags({
          remoteApiKeySet: view.remoteApiKeySet,
          feishuAppSecretSet: view.feishuAppSecretSet,
          feishuAccessTokenSet: view.feishuAccessTokenSet,
          feishuRefreshTokenSet: view.feishuRefreshTokenSet,
        });
      })
      .catch(() => {
        if (active) setError("无法读取设置。");
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    setSourcesLoading(true);
    listKnowledgeSources()
      .then((sources) => {
        if (active) setKnowledgeSources(sources);
      })
      .catch(() => {
        if (active) setSourcesError("无法读取知识来源。");
      })
      .finally(() => {
        if (active) setSourcesLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  function update(field: keyof AppSettings, value: string) {
    setSettings((current) => ({
      ...current,
      [field]: value,
    }));
  }

  // True when the form differs from the last loaded/saved snapshot, so the user
  // can see at a glance that there are unsaved changes.
  const dirty = JSON.stringify(settings) !== JSON.stringify(savedSettings);

  async function runPostSaveVerification() {
    const url = (settings.localBaseUrl ?? "").trim();
    if (!url) return;
    try {
      const [probe] = await probeLocalServices({ candidates: [url] });
      if (!activeRef.current) return;
      if (probe.reachable) {
        setPostSaveVerify(
          probe.models.length > 0
            ? `保存后验证成功：本地服务可连接，检测到 ${probe.models.length} 个可用模型。`
            : "保存后验证成功：本地服务可连接。",
        );
      } else {
        setPostSaveVerify(
          `保存后验证失败：${translateServiceError(probe.error ?? "connection_refused", { serviceLabel: "本地服务" }).title}`,
        );
      }
    } catch {
      if (activeRef.current) setPostSaveVerify("保存后验证失败：无法连接本地服务。");
    }
  }

  async function handleSave() {
    setError(null);
    setStatus(null);
    setPostSaveVerify(null);
    const errors = validateSettings(settings, discoveredModels);
    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }
    setValidationErrors([]);
    setSaving(true);
    try {
      await saveAppSettings(settings, {
        remoteApiKey,
        feishuAppSecret,
        feishuAccessToken,
        feishuRefreshToken,
      });
    } catch {
      // Roll back to the last successfully saved/loaded snapshot so a failed
      // save never leaves the form in a misleading "saved" state.
      setSettings(savedSettings);
      setError("保存设置失败，请重试。");
      setSaving(false);
      return;
    }
    setSavedSettings(settings);
    try {
      await restartSidecar();
      setRemoteApiKey("");
      setFeishuAppSecret("");
      setFeishuAccessToken("");
      setFeishuRefreshToken("");
      setStatus("设置已保存，正在重新确认准备状态。");
      onSettingsApplied?.();
      void runPostSaveVerification();
    } catch {
      setError("设置已保存，但服务重新加载失败，请重启应用。");
    } finally {
      setSaving(false);
    }
  }

  async function handleClearSecret(kind: SecretKind) {
    setError(null);
    setStatus(null);
    try {
      await saveAppSettings(settings, {
        remoteApiKey: kind === "remoteApiKey" ? "" : undefined,
        feishuAppSecret: kind === "feishuAppSecret" ? "" : undefined,
        feishuAccessToken: kind === "feishuAccessToken" ? "" : undefined,
        feishuRefreshToken: kind === "feishuRefreshToken" ? "" : undefined,
      });
    } catch {
      setError("清除密钥失败，请重试。");
      return;
    }
    try {
      await restartSidecar();
      const flagKey =
        kind === "remoteApiKey"
          ? "remoteApiKeySet"
          : kind === "feishuAppSecret"
            ? "feishuAppSecretSet"
            : kind === "feishuAccessToken"
              ? "feishuAccessTokenSet"
              : "feishuRefreshTokenSet";
      setSecretFlags((current) => ({ ...current, [flagKey]: false }));
      setStatus("已清除已保存的密钥，正在重新确认准备状态。");
      onSettingsApplied?.();
    } catch {
      setError("密钥已清除，但服务重新加载失败，请重启应用。");
    }
  }

  async function handleDeleteSource(source: KnowledgeSource) {
    setSourcesError(null);
    try {
      await deleteKnowledgeSource(source.documentId);
      setKnowledgeSources((current) =>
        current.filter((item) => item.documentId !== source.documentId),
      );
    } catch {
      setSourcesError("无法删除知识来源。");
    } finally {
      setConfirmingSourceId(null);
    }
  }

  async function handleSetEnabled(
    source: KnowledgeSource,
    enabled: boolean,
  ) {
    setSourcesError(null);
    try {
      await setKnowledgeSourceEnabled(source.documentId, enabled);
      setKnowledgeSources((current) =>
        current.map((item) =>
          item.documentId === source.documentId
            ? { ...item, enabled, status: enabled ? "ready" : "paused" }
            : item,
        ),
      );
    } catch {
      setSourcesError(enabled ? "无法启用该知识源。" : "无法暂停该知识源。");
    }
  }

  async function handleResync(source: KnowledgeSource) {
    setSourcesError(null);
    try {
      await resyncKnowledgeSource(source.documentId);
      setKnowledgeSources((current) =>
        current.map((item) =>
          item.documentId === source.documentId
            ? { ...item, status: "syncing", syncProgress: 0 }
            : item,
        ),
      );
    } catch {
      setSourcesError("无法重新同步该知识源。");
    }
  }

  function openDeleteSource(source: KnowledgeSource) {
    setConfirmingSourceId(source.documentId);
  }

  function closeDeleteSource() {
    setConfirmingSourceId(null);
  }

  async function handleClearAllData() {
    setError(null);
    setStatus(null);
    try {
      await clearAllLocalData();
      await deleteCapturedTempMedia();
      setKnowledgeSources([]);
      setStatus("已清空对话、记忆和知识来源。");
    } catch {
      setError("清空本地数据失败，请重试。");
    } finally {
      setConfirmingClearAll(false);
    }
  }

  function openClearAllData() {
    setConfirmingClearAll(true);
  }

  function closeClearAllData() {
    setConfirmingClearAll(false);
  }

  async function handleResetSettings() {
    setError(null);
    setStatus(null);
    try {
      await resetAllSettings();
      await restartSidecar();
      setSettings(emptySettings);
      setSecretFlags(emptySecretFlags);
      setRemoteApiKey("");
      setFeishuAppSecret("");
      setFeishuAccessToken("");
      setFeishuRefreshToken("");
      setStatus("设置已重置。");
      onSettingsApplied?.();
    } catch {
      setError("重置设置失败，请重试。");
    } finally {
      setConfirmingReset(false);
    }
  }

  function openResetSettings() {
    setConfirmingReset(true);
  }

  function closeResetSettings() {
    setConfirmingReset(false);
  }

  return (
    <section className="studio-status" aria-label="设置">
      <div>
        <p className="studio-status-title">设置</p>
        <ServiceStatusPanel
          settings={settings}
          feishuAccessTokenSet={secretFlags.feishuAccessTokenSet}
          feishuAccessToken={feishuAccessToken}
        />
        <LocalModelPanel
          settings={settings}
          update={update}
          onModelsDiscovered={setDiscoveredModels}
        />
        <DataScopeCard />
        <RemoteServicePanel
          settings={settings}
          update={update}
          remoteApiKey={remoteApiKey}
          setRemoteApiKey={setRemoteApiKey}
          remoteApiKeySet={secretFlags.remoteApiKeySet}
          onClearSecret={handleClearSecret}
        />
        <FeishuKnowledgePanel
          settings={settings}
          update={update}
          secretFlags={secretFlags}
          feishuAppSecret={feishuAppSecret}
          setFeishuAppSecret={setFeishuAppSecret}
          feishuAccessToken={feishuAccessToken}
          setFeishuAccessToken={setFeishuAccessToken}
          feishuRefreshToken={feishuRefreshToken}
          setFeishuRefreshToken={setFeishuRefreshToken}
          onClearSecret={handleClearSecret}
          knowledgeSources={knowledgeSources}
          sourcesLoading={sourcesLoading}
          sourcesError={sourcesError}
          confirmingSourceId={confirmingSourceId}
          onDeleteSource={handleDeleteSource}
          onOpenDelete={openDeleteSource}
          onCloseDelete={closeDeleteSource}
          onSetEnabled={handleSetEnabled}
          onResync={handleResync}
        />
        <MyDigitalHumanPanel />
        <MemoryPanel setStatus={setStatus} setError={setError} />
        <PrivacyPanel
          confirmingClearAll={confirmingClearAll}
          confirmingReset={confirmingReset}
          onClearAllData={handleClearAllData}
          onOpenClearAll={openClearAllData}
          onCloseClearAll={closeClearAllData}
          onOpenReset={openResetSettings}
          onCloseReset={closeResetSettings}
          onResetSettings={handleResetSettings}
        />
        <DiagnosticsPanel settings={settings} secretFlags={secretFlags} />
        {/* <UpdatePanel /> */}
        <AdvancedPanel settings={settings} update={update} />

        {validationErrors.length > 0 ? (
          <ul role="alert" className="settings-validation-errors">
            {validationErrors.map((message, index) => (
              <li key={index}>{message}</li>
            ))}
          </ul>
        ) : null}
        {postSaveVerify ? (
          <p data-testid="post-save-verification" role="note">
            {postSaveVerify}
          </p>
        ) : null}
        {status ? (
          <p role="status" data-testid="settings-save-status">
            {status}
          </p>
        ) : null}
        {error ? <p role="alert">{error}</p> : null}
        {dirty ? (
          <p role="status" className="settings-dirty">
            有未保存的改动。
          </p>
        ) : null}
        <button type="button" onClick={() => void handleSave()} disabled={saving}>
          {saving ? "保存中…" : dirty ? "保存设置（未保存改动）" : "保存设置"}
        </button>
      </div>
    </section>
  );
}