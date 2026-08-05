import { useState } from "react";

import SettingsPanel from "./SettingsPanel";
import {
  ProviderVerifyDetail,
  providerVerifyDetailStepLabel,
  verifyProviderDetail,
} from "./providerVerify";
import { checkRemoteProvider, verifyProviderDeep } from "./settingsClient";
import type { AppSettings, SecretKind, ProviderVerification } from "./settingsClient";
import { asText } from "./settingsText";
import DeepVerificationCard from "./DeepVerificationCard";

interface RemoteServicePanelProps {
  readonly settings: AppSettings;
  readonly update: (field: keyof AppSettings, value: string) => void;
  readonly remoteApiKey: string;
  readonly setRemoteApiKey: (value: string) => void;
  readonly remoteApiKeySet: boolean;
  readonly onClearSecret: (kind: SecretKind) => void;
}

export default function RemoteServicePanel({
  settings,
  update,
  remoteApiKey,
  setRemoteApiKey,
  remoteApiKeySet,
  onClearSecret,
}: RemoteServicePanelProps) {
  const [checking, setChecking] = useState(false);
  const [detail, setDetail] = useState<ProviderVerifyDetail | null>(null);
  const [deepVerification, setDeepVerification] =
    useState<ProviderVerification | null>(null);

  async function handleCheck() {
    setChecking(true);
    setDeepVerification(null);
    try {
      const result = await verifyProviderDetail(
        settings.remoteBaseUrl,
        checkRemoteProvider,
        "remote",
      );
      setDetail(result);
      try {
        const verification = await verifyProviderDeep("remote_gpu", {
          endpoint: settings.remoteBaseUrl?.trim() || undefined,
          api_key: remoteApiKey.trim() || undefined,
          timeout_seconds: settings.localTimeoutSeconds ?? undefined,
        });
        setDeepVerification(verification);
      } catch {
        // The shallow check above already reported reachability; keep its result.
      }
    } finally {
      setChecking(false);
    }
  }

  return (
    <SettingsPanel title="远程数字人服务">
      <label>
        服务地址
        <input
          value={asText(settings.remoteBaseUrl)}
          onChange={(event) => update("remoteBaseUrl", event.target.value)}
        />
      </label>
      <button type="button" onClick={() => void handleCheck()} disabled={checking}>
        {checking ? "检查中…" : "测试远程连接"}
      </button>
      {detail ? (
        <div
          className="settings-verify-card"
          data-testid="remote-verify-detail"
          role={detail.state === "verified" ? "status" : "note"}
        >
          <p>
            <strong>
              {detail.state === "verified" ? "验证成功" : "验证未通过"}
            </strong>
          </p>
          <dl className="settings-verify-fields">
            <div>
              <dt>连接地址</dt>
              <dd>{detail.url || "未填写"}</dd>
            </div>
            <div>
              <dt>Provider 类型</dt>
              <dd>{detail.providerType === "remote" ? "远程服务" : "本地服务"}</dd>
            </div>
            <div>
              <dt>响应耗时</dt>
              <dd>{detail.step === "unconfigured" ? "—" : `${detail.latencyMs.toFixed(0)} ms`}</dd>
            </div>
            <div>
              <dt>检查步骤</dt>
              <dd>{providerVerifyDetailStepLabel(detail.step)}</dd>
            </div>
          </dl>
          {detail.detail ? <p>{detail.detail}</p> : null}
        </div>
      ) : null}
      {deepVerification ? (
        <DeepVerificationCard verification={deepVerification} />
      ) : null}
      <label>
        API Key
        <input
          type="password"
          value={remoteApiKey}
          placeholder={remoteApiKeySet ? "已保存，留空表示不修改" : ""}
          onChange={(event) => setRemoteApiKey(event.target.value)}
        />
      </label>
      {remoteApiKeySet ? (
        <button
          type="button"
          onClick={() => onClearSecret("remoteApiKey")}
        >
          清除已保存的 API Key
        </button>
      ) : null}
    </SettingsPanel>
  );
}