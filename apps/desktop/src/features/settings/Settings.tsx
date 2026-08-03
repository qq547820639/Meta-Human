import { useEffect, useState } from "react";

import {
  AppSettings,
  AppSettingsView,
  checkLocalProvider,
  checkRemoteProvider,
  exchangeFeishuCode,
  loadAppSettings,
  openFeishuAuthorization,
  resetAllSettings,
  restartSidecar,
  saveAppSettings,
  startFeishuOauth,
} from "./settingsClient";
import {
  KnowledgeSource,
  deleteKnowledgeSource,
  listKnowledgeSources,
} from "../knowledge/knowledgeClient";
import { clearAllLocalData } from "../privacy/privacyClient";
import { deleteCapturedTempMedia } from "../creation/captureClient";
import {
  clearConversationMemory,
  getConversationMemory,
  updateConversationMemory,
} from "../memory/memoryClient";

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

function asText(value: string | number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

interface SettingsProps {
  readonly onSettingsApplied?: () => void;
}

export default function Settings({ onSettingsApplied }: SettingsProps) {
  const [settings, setSettings] = useState<AppSettings>(emptySettings);
  const [secretFlags, setSecretFlags] = useState({
    remoteApiKeySet: false,
    feishuAppSecretSet: false,
    feishuAccessTokenSet: false,
    feishuRefreshTokenSet: false,
  });
  const [remoteApiKey, setRemoteApiKey] = useState("");
  const [feishuAppSecret, setFeishuAppSecret] = useState("");
  const [feishuAccessToken, setFeishuAccessToken] = useState("");
  const [feishuRefreshToken, setFeishuRefreshToken] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [localCheck, setLocalCheck] = useState<string | null>(null);
  const [remoteCheck, setRemoteCheck] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkSummary, setCheckSummary] = useState<{
    local: string;
    remote: string;
    feishu: string;
  } | null>(null);
  const [feishuCode, setFeishuCode] = useState("");
  const [oauthStatus, setOauthStatus] = useState<string | null>(null);
  const [knowledgeSources, setKnowledgeSources] = useState<KnowledgeSource[]>(
    [],
  );
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [sourcesError, setSourcesError] = useState<string | null>(null);
  const [confirmingSourceId, setConfirmingSourceId] = useState<string | null>(
    null,
  );
  const [confirmingClearAll, setConfirmingClearAll] = useState(false);
  const [memorySummary, setMemorySummary] = useState("");
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const [savingMemory, setSavingMemory] = useState(false);
  const [confirmingMemoryClear, setConfirmingMemoryClear] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);

  const feishuRedirectUri = "http://127.0.0.1:1420/oauth/feishu";

  useEffect(() => {
    let active = true;
    loadAppSettings()
      .then((view: AppSettingsView) => {
        if (!active) return;
        setSettings({ ...emptySettings, ...view.settings });
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
    setMemoryLoading(true);
    getConversationMemory()
      .then((memory) => {
        if (active) setMemorySummary(memory?.summary ?? "");
      })
      .catch(() => {
        if (active) setMemoryError("无法读取长期记忆。");
      })
      .finally(() => {
        if (active) setMemoryLoading(false);
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

  async function handleSave() {
    setError(null);
    setStatus(null);
    setSaving(true);
    try {
      await saveAppSettings(settings, {
        remoteApiKey,
        feishuAppSecret,
        feishuAccessToken,
        feishuRefreshToken,
      });
    } catch {
      setError("保存设置失败，请重试。");
      return;
    }
    try {
      await restartSidecar();
      setRemoteApiKey("");
      setFeishuAppSecret("");
      setFeishuAccessToken("");
      setFeishuRefreshToken("");
      setStatus("设置已保存，正在重新确认准备状态。");
      onSettingsApplied?.();
    } catch {
      setError("设置已保存，但服务重新加载失败，请重启应用。");
    } finally {
      setSaving(false);
    }
  }

  async function handleClearSecret(
    kind:
      | "remoteApiKey"
      | "feishuAppSecret"
      | "feishuAccessToken"
      | "feishuRefreshToken",
  ) {
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

  async function handleCheckLocal() {
    const url = settings.localBaseUrl?.trim();
    if (!url) {
      setLocalCheck("请先填写本地服务地址。");
      return;
    }
    setChecking(true);
    try {
      const reachable = await checkLocalProvider(url);
      setLocalCheck(reachable ? "本地服务可连接。" : "无法连接本地服务。");
    } catch {
      setLocalCheck("无法检查本地服务。");
    } finally {
      setChecking(false);
    }
  }

  async function handleCheckRemote() {
    const url = settings.remoteBaseUrl?.trim();
    if (!url) {
      setRemoteCheck("请先填写远程服务地址。");
      return;
    }
    setChecking(true);
    try {
      const reachable = await checkRemoteProvider(url);
      setRemoteCheck(
        reachable ? "远程服务可连接。" : "无法连接远程服务。",
      );
    } catch {
      setRemoteCheck("无法检查远程服务。");
    } finally {
      setChecking(false);
    }
  }

  async function handleRunChecks() {
    setError(null);
    setChecking(true);
    const localUrl = settings.localBaseUrl?.trim();
    const remoteUrl = settings.remoteBaseUrl?.trim();
    const feishuConfigured = Boolean(
      settings.feishuAppId?.trim() &&
        settings.feishuSpaceId?.trim() &&
        (secretFlags.feishuAccessTokenSet || feishuAccessToken.trim()),
    );
    const [local, remote] = await Promise.all([
      localUrl
        ? checkLocalProvider(localUrl)
            .then((ok) => (ok ? "可连接" : "无法连接"))
            .catch(() => "无法连接")
        : Promise.resolve("未配置"),
      remoteUrl
        ? checkRemoteProvider(remoteUrl)
            .then((ok) => (ok ? "可连接" : "无法连接"))
            .catch(() => "无法连接")
        : Promise.resolve("未配置"),
    ]);
    setCheckSummary({
      local,
      remote,
      feishu: feishuConfigured ? "已配置" : "未配置",
    });
    setChecking(false);
  }

  async function handleOpenFeishuAuthorization() {
    const appId = settings.feishuAppId?.trim();
    if (!appId) {
      setOauthStatus("请先填写飞书 App ID。");
      return;
    }
    try {
      await openFeishuAuthorization(appId, feishuRedirectUri);
      setOauthStatus("已在浏览器打开飞书授权页面。");
    } catch {
      setOauthStatus("无法打开飞书授权页面。");
    }
  }

  async function handleExchangeFeishuCode() {
    const appId = settings.feishuAppId?.trim();
    const appSecret = feishuAppSecret.trim();
    const code = feishuCode.trim();
    if (!appId || !appSecret || !code) {
      setOauthStatus("请填写 App ID、App Secret 和授权码。");
      return;
    }
    try {
      const bundle = await exchangeFeishuCode(
        code,
        appId,
        appSecret,
        feishuRedirectUri,
      );
      setFeishuAccessToken(bundle.accessToken);
      setFeishuRefreshToken(bundle.refreshToken);
      setOauthStatus("Access Token 已获取，保存设置后生效。");
    } catch {
      setOauthStatus("换取 Access Token 失败。");
    }
  }

  async function handleStartFeishuOauth() {
    const appId = settings.feishuAppId?.trim();
    const appSecret = feishuAppSecret.trim();
    if (!appId || !appSecret) {
      setOauthStatus("请填写飞书 App ID 和 App Secret。");
      return;
    }
    setOauthStatus("正在打开飞书授权页面，请在浏览器中完成授权…");
    try {
      const code = await startFeishuOauth(appId);
      const bundle = await exchangeFeishuCode(
        code,
        appId,
        appSecret,
        feishuRedirectUri,
      );
      setFeishuAccessToken(bundle.accessToken);
      setFeishuRefreshToken(bundle.refreshToken);
      setOauthStatus("飞书授权完成，Access Token 已获取，保存设置后生效。");
    } catch {
      setOauthStatus("飞书授权失败，请重试或使用手动授权。");
    }
  }

  async function handleDeleteSource(source: KnowledgeSource) {
    if (confirmingSourceId !== source.documentId) {
      setConfirmingSourceId(source.documentId);
      window.setTimeout(() => {
        setConfirmingSourceId((current) =>
          current === source.documentId ? null : current,
        );
      }, 3000);
      return;
    }
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

  async function handleClearAllData() {
    if (!confirmingClearAll) {
      setConfirmingClearAll(true);
      window.setTimeout(() => setConfirmingClearAll(false), 3000);
      return;
    }
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

  async function handleSaveMemory() {
    if (!memorySummary.trim()) return;
    setError(null);
    setMemoryError(null);
    setSavingMemory(true);
    try {
      await updateConversationMemory(memorySummary.trim());
      setStatus("长期记忆已更新。");
    } catch {
      setMemoryError("无法更新长期记忆。");
    } finally {
      setSavingMemory(false);
    }
  }

  async function handleClearMemory() {
    if (!confirmingMemoryClear) {
      setConfirmingMemoryClear(true);
      window.setTimeout(() => setConfirmingMemoryClear(false), 3000);
      return;
    }
    setMemoryError(null);
    try {
      await clearConversationMemory();
      setMemorySummary("");
      setStatus("长期记忆已清空。");
    } catch {
      setMemoryError("无法清空长期记忆。");
    } finally {
      setConfirmingMemoryClear(false);
    }
  }

  async function handleResetSettings() {
    if (!confirmingReset) {
      setConfirmingReset(true);
      window.setTimeout(() => setConfirmingReset(false), 3000);
      return;
    }
    setError(null);
    setStatus(null);
    try {
      await resetAllSettings();
      await restartSidecar();
      setSettings(emptySettings);
      setSecretFlags({
        remoteApiKeySet: false,
        feishuAppSecretSet: false,
        feishuAccessTokenSet: false,
        feishuRefreshTokenSet: false,
      });
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

  return (
    <section className="studio-status" aria-label="设置">
      <div>
        <p className="studio-status-title">设置</p>
        <button type="button" onClick={handleRunChecks} disabled={checking}>
          {checking ? "检查中…" : "一键检查连接"}
        </button>
        {checkSummary ? (
          <ul aria-label="连接检查结果">
            <li>本地模型：{checkSummary.local}</li>
            <li>远程 GPU：{checkSummary.remote}</li>
            <li>飞书知识：{checkSummary.feishu}</li>
          </ul>
        ) : null}
        <p>本地模型</p>
        <label>
          本地服务地址
          <input
            value={asText(settings.localBaseUrl)}
            onChange={(event) => update("localBaseUrl", event.target.value)}
          />
        </label>
        <button type="button" onClick={handleCheckLocal} disabled={checking}>
          {checking ? "检查中…" : "测试本地连接"}
        </button>
        {localCheck ? <p>{localCheck}</p> : null}
        <details className="settings-advanced">
          <summary>高级本地模型</summary>
        <label>
          对话模型
          <input
            value={asText(settings.localChatModel)}
            onChange={(event) => update("localChatModel", event.target.value)}
          />
        </label>
        <label>
          嵌入模型
          <input
            value={asText(settings.localEmbeddingModel)}
            onChange={(event) =>
              update("localEmbeddingModel", event.target.value)
            }
          />
        </label>
        <label>
          语音识别模型
          <input
            value={asText(settings.localSttModel)}
            onChange={(event) => update("localSttModel", event.target.value)}
          />
        </label>
        <label>
          超时秒数
          <input
            type="number"
            value={asText(settings.localTimeoutSeconds)}
            onChange={(event) => update("localTimeoutSeconds", event.target.value)}
          />
        </label>
        </details>

        <p>远程 GPU</p>
        <label>
          服务地址
          <input
            value={asText(settings.remoteBaseUrl)}
            onChange={(event) => update("remoteBaseUrl", event.target.value)}
          />
        </label>
        <button type="button" onClick={handleCheckRemote} disabled={checking}>
          {checking ? "检查中…" : "测试远程连接"}
        </button>
        {remoteCheck ? <p>{remoteCheck}</p> : null}
        <label>
          API Key
          <input
            type="password"
            value={remoteApiKey}
            placeholder={
              secretFlags.remoteApiKeySet ? "已保存，留空表示不修改" : ""
            }
            onChange={(event) => setRemoteApiKey(event.target.value)}
          />
        </label>
        {secretFlags.remoteApiKeySet ? (
          <button
            type="button"
            onClick={() => void handleClearSecret("remoteApiKey")}
          >
            清除已保存的 API Key
          </button>
        ) : null}
        <details className="settings-advanced">
          <summary>高级远程配置</summary>
        <label>
          TTS 音色
          <input
            value={asText(settings.remoteTtsVoice)}
            onChange={(event) => update("remoteTtsVoice", event.target.value)}
          />
        </label>
        <details>
          <summary>远程端点路径</summary>
          <label>
            语音注册路径
            <input
              value={asText(settings.remoteVoiceEnrollPath)}
              onChange={(event) =>
                update("remoteVoiceEnrollPath", event.target.value)
              }
            />
          </label>
          <label>
            形象注册路径
            <input
              value={asText(settings.remoteAvatarEnrollPath)}
              onChange={(event) =>
                update("remoteAvatarEnrollPath", event.target.value)
              }
            />
          </label>
          <label>
            形象流路径
            <input
              value={asText(settings.remoteAvatarStreamPath)}
              onChange={(event) =>
                update("remoteAvatarStreamPath", event.target.value)
              }
            />
          </label>
          <label>
            形象流停止路径
            <input
              value={asText(settings.remoteAvatarStreamStopPath)}
              onChange={(event) =>
                update("remoteAvatarStreamStopPath", event.target.value)
              }
            />
          </label>
          <label>
            TTS 路径
            <input
              value={asText(settings.remoteTtsPath)}
              onChange={(event) => update("remoteTtsPath", event.target.value)}
            />
          </label>
        </details>
        </details>

        <p>飞书知识</p>
        <label>
          应用 App ID
          <input
            value={asText(settings.feishuAppId)}
            onChange={(event) => update("feishuAppId", event.target.value)}
          />
        </label>
        <label>
          应用 App Secret
          <input
            type="password"
            value={feishuAppSecret}
            placeholder={
              secretFlags.feishuAppSecretSet ? "已保存，留空表示不修改" : ""
            }
            onChange={(event) => setFeishuAppSecret(event.target.value)}
          />
        </label>
        {secretFlags.feishuAppSecretSet ? (
          <button
            type="button"
            onClick={() => void handleClearSecret("feishuAppSecret")}
          >
            清除已保存的 App Secret
          </button>
        ) : null}
        <label>
          Access Token
          <input
            type="password"
            value={feishuAccessToken}
            placeholder={
              secretFlags.feishuAccessTokenSet ? "已保存，留空表示不修改" : ""
            }
            onChange={(event) => setFeishuAccessToken(event.target.value)}
          />
        </label>
        {secretFlags.feishuAccessTokenSet ? (
          <button
            type="button"
            onClick={() => void handleClearSecret("feishuAccessToken")}
          >
            清除已保存的 Access Token
          </button>
        ) : null}
        {secretFlags.feishuRefreshTokenSet ? (
          <button
            type="button"
            onClick={() => void handleClearSecret("feishuRefreshToken")}
          >
            清除已保存的 Refresh Token
          </button>
        ) : null}
        <button type="button" onClick={handleStartFeishuOauth}>
          授权飞书
        </button>
        <label>
          知识空间 ID
          <input
            value={asText(settings.feishuSpaceId)}
            onChange={(event) => update("feishuSpaceId", event.target.value)}
          />
        </label>
        <details>
          <summary>手动授权</summary>
          <button type="button" onClick={handleOpenFeishuAuthorization}>
            打开飞书授权页面
          </button>
          <label>
            授权码
            <input
              value={feishuCode}
              onChange={(event) => setFeishuCode(event.target.value)}
            />
          </label>
          <button type="button" onClick={handleExchangeFeishuCode}>
            用授权码获取 Token
          </button>
        </details>
        {oauthStatus ? <p>{oauthStatus}</p> : null}
        <label>
          飞书服务地址
          <input
            value={asText(settings.feishuBaseUrl)}
            onChange={(event) => update("feishuBaseUrl", event.target.value)}
          />
        </label>

        <p>知识来源</p>
        {sourcesLoading ? (
          <p role="status">正在读取知识来源…</p>
        ) : null}
        {sourcesError ? <p role="alert">{sourcesError}</p> : null}
        {knowledgeSources.length === 0 && !sourcesLoading ? (
          <p>还没有同步的知识来源。</p>
        ) : (
          <ul aria-label="知识来源列表">
            {knowledgeSources.map((source) => (
              <li key={source.documentId}>
                {source.title} · {source.chunkCount} 段
                {source.sourceUrl ? (
                  <a
                    href={source.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    打开
                  </a>
                ) : null}
                <button
                  type="button"
                  onClick={() => void handleDeleteSource(source)}
                >
                  {confirmingSourceId === source.documentId
                    ? "确认删除？"
                    : "删除"}
                </button>
              </li>
            ))}
          </ul>
        )}

        <button type="button" onClick={() => void handleClearAllData()}>
          {confirmingClearAll ? "确认清空本地数据？" : "清空本地数据"}
        </button>
        <button type="button" onClick={() => void handleResetSettings()}>
          {confirmingReset ? "确认重置设置？" : "重置全部设置"}
        </button>

        <p>长期记忆</p>
        {memoryLoading ? (
          <p role="status">正在读取长期记忆…</p>
        ) : null}
        {memoryError ? <p role="alert">{memoryError}</p> : null}
        <label>
          记忆摘要
          <textarea
            value={memorySummary}
            onChange={(event) => setMemorySummary(event.target.value)}
            rows={3}
            disabled={memoryLoading}
          />
        </label>
        <button
          type="button"
          onClick={() => void handleSaveMemory()}
          disabled={savingMemory || memoryLoading}
        >
          {savingMemory ? "保存中…" : "保存记忆"}
        </button>
        <button type="button" onClick={() => void handleClearMemory()}>
          {confirmingMemoryClear ? "确认清空记忆？" : "清空记忆"}
        </button>

        {status ? <p role="status">{status}</p> : null}
        {error ? <p role="alert">{error}</p> : null}
          <button type="button" onClick={handleSave} disabled={saving}>
            {saving ? "保存中…" : "保存设置"}
          </button>
      </div>
    </section>
  );
}
