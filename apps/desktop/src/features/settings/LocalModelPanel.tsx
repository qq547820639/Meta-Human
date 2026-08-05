import { useState } from "react";

import SettingsPanel from "./SettingsPanel";
import {
  LocalServiceProbe,
  probeLocalServices,
  serviceLabelForUrl,
} from "./localProbe";
import {
  ACTION_LABELS,
  ErrorActionKind,
  TranslatedError,
  translateErrorCode,
  translateServiceError,
} from "./errorTranslation";
import {
  ModelCapabilityIssue,
  validateModelCapability,
} from "./modelCapability";
import {
  checkLocalProvider,
  openSystemPermissions,
} from "./settingsClient";
import type { AppSettings } from "./settingsClient";
import { asText } from "./settingsText";

interface LocalModelPanelProps {
  readonly settings: AppSettings;
  readonly update: (field: keyof AppSettings, value: string) => void;
  /** Reports the live model ids of the currently selected local service. */
  readonly onModelsDiscovered: (modelIds: string[]) => void;
}

const roleSelectMeta: Array<{
  field: keyof AppSettings;
  role: "chat" | "embedding" | "stt";
  label: string;
}> = [
  { field: "localChatModel", role: "chat", label: "对话模型" },
  { field: "localEmbeddingModel", role: "embedding", label: "嵌入模型" },
  { field: "localSttModel", role: "stt", label: "语音识别模型" },
];

export default function LocalModelPanel({
  settings,
  update,
  onModelsDiscovered,
}: LocalModelPanelProps) {
  const [scanning, setScanning] = useState(false);
  const [probes, setProbes] = useState<LocalServiceProbe[] | null>(null);
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<TranslatedError | null>(null);
  const [checkSuccess, setCheckSuccess] = useState<string | null>(null);

  const reachable =
    probes === null ? [] : probes.filter((probe) => probe.reachable);
  const selected =
    (probes ?? []).find((probe) => probe.baseUrl === selectedUrl) ??
    reachable[0];
  const availableModelIds = (selected?.models ?? []).map((model) => model.id);

  const modelIssues: ModelCapabilityIssue[] = validateModelCapability({
    chatModel: asText(settings.localChatModel),
    embeddingModel: asText(settings.localEmbeddingModel),
    sttModel: asText(settings.localSttModel),
    availableModels: availableModelIds,
  });

  async function handleScan() {
    setScanning(true);
    setCheckError(null);
    setCheckSuccess(null);
    try {
      const results = await probeLocalServices();
      setProbes(results);
      const firstReachable = results.find((probe) => probe.reachable);
      if (firstReachable) {
        setSelectedUrl(firstReachable.baseUrl);
        onModelsDiscovered(
          firstReachable.models.map((model) => model.id),
        );
        if (!settings.localBaseUrl?.trim()) {
          update("localBaseUrl", firstReachable.baseUrl);
        }
      } else {
        setSelectedUrl(null);
        onModelsDiscovered([]);
      }
    } finally {
      setScanning(false);
    }
  }

  async function handleCheck() {
    setChecking(true);
    setCheckError(null);
    setCheckSuccess(null);
    try {
      const url = settings.localBaseUrl?.trim();
      if (!url) {
        setCheckError(
          translateErrorCode("unconfigured", { serviceLabel: "本地服务" }),
        );
        return;
      }
      const ok = await checkLocalProvider(url);
      if (!ok) {
        setCheckError(
          translateServiceError(
            new Error("connection refused", { cause: { code: "ECONNREFUSED" } }),
            { serviceLabel: "本地服务" },
          ),
        );
      } else {
        setCheckSuccess("本地服务连接正常（验证成功）。");
      }
    } catch (raw) {
      setCheckError(
        translateServiceError(raw, { serviceLabel: "本地服务" }),
      );
    } finally {
      setChecking(false);
    }
  }

  function handleAction(action: ErrorActionKind) {
    switch (action) {
      case "retry":
        void handleCheck();
        return;
      case "open_permissions":
        void openSystemPermissions().catch(() => undefined);
        return;
      case "reauthorize":
        void handleScan();
        return;
      case "reselect_model":
        void handleScan();
        return;
    }
  }

  function handleSelectService(event: React.ChangeEvent<HTMLSelectElement>) {
    const url = event.target.value;
    setSelectedUrl(url);
    const probe = (probes ?? []).find((item) => item.baseUrl === url);
    onModelsDiscovered((probe?.models ?? []).map((model) => model.id));
    update("localBaseUrl", url);
  }

  return (
    <SettingsPanel title="本地模型">
      <p>
        自动检测电脑上的本地模型服务（Ollama / LM Studio），扫码后可从可用模型中
        直接选择。找不到也没关系，可以手动填写地址。
      </p>
      <button
        type="button"
        onClick={() => void handleScan()}
        disabled={scanning}
      >
        {scanning ? "扫描中…" : "扫描本地模型服务"}
      </button>

      {probes !== null ? (
        <div className="settings-probes" data-testid="probe-results">
          {reachable.length > 0 ? (
            <>
              <label>
                检测到的服务
                <select
                  value={selected?.baseUrl ?? ""}
                  onChange={handleSelectService}
                >
                  {reachable.map((probe) => (
                    <option key={probe.baseUrl} value={probe.baseUrl}>
                      {probe.label}（{probe.models.length} 个模型）
                    </option>
                  ))}
                </select>
              </label>
              {availableModelIds.length > 0 ? (
                roleSelectMeta.map(({ field, role, label }) => (
                  <label key={field}>
                    {label}
                    <select
                      value={asText(settings[field])}
                      onChange={(event) => update(field, event.target.value)}
                    >
                      <option value="">请选择</option>
                      {availableModelIds.map((id) => (
                        <option key={id} value={id}>
                          {id}
                        </option>
                      ))}
                    </select>
                  </label>
                ))
              ) : (
                <p>该服务没有返回可用模型列表。</p>
              )}
              {modelIssues.map((issue, index) => (
                <p
                  key={`${issue.modelId}-${index}`}
                  role={issue.severity === "error" ? "alert" : "note"}
                  className={`model-issue model-issue-${issue.severity}`}
                >
                  {issue.message}
                </p>
              ))}
            </>
          ) : (
            <p role="alert">
              未检测到本地模型服务。请确认 Ollama / LM Studio 已启动，再点击重试。
            </p>
          )}
        </div>
      ) : null}

      <label>
        本地服务地址
        <input
          value={asText(settings.localBaseUrl)}
          onChange={(event) => update("localBaseUrl", event.target.value)}
        />
      </label>
      <button
        type="button"
        onClick={() => void handleCheck()}
        disabled={checking}
      >
        {checking ? "检查中…" : "测试本地连接"}
      </button>

      {checkSuccess ? <p role="status">{checkSuccess}</p> : null}

      {checkError ? (
        <div className="settings-error-card" role="note">
          <p>
            <strong>{checkError.title}</strong>
          </p>
          <ul>
            {checkError.steps.map((step, index) => (
              <li key={index}>{step}</li>
            ))}
          </ul>
          <div className="settings-error-actions">
            {checkError.actions.map((action) => (
              <button
                key={action}
                type="button"
                onClick={() => handleAction(action)}
              >
                {ACTION_LABELS[action]}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <p className="settings-hint">
        提示：本地模型只在你的电脑上运行，提问、文本和录音不会上传到远程服务。
      </p>
    </SettingsPanel>
  );
}
