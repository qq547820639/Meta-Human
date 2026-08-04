import { useState } from "react";

import SettingsPanel from "./SettingsPanel";
import {
  ProviderVerifyState,
  verifyProvider,
  verifyStateMessage,
} from "./providerVerify";
import { checkRemoteProvider } from "./settingsClient";
import type { AppSettings, SecretKind } from "./settingsClient";
import { asText } from "./settingsText";

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
  const [state, setState] = useState<ProviderVerifyState | null>(null);

  async function handleCheck() {
    setState("verifying");
    setChecking(true);
    try {
      setState(await verifyProvider(settings.remoteBaseUrl, checkRemoteProvider));
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
      {state ? <p>{verifyStateMessage("远程", state)}</p> : null}
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