import { useState } from "react";

import SettingsPanel from "./SettingsPanel";
import {
  ProviderVerifyState,
  verifyProvider,
  verifyStateMessage,
} from "./providerVerify";
import { checkLocalProvider } from "./settingsClient";
import type { AppSettings } from "./settingsClient";
import { asText } from "./settingsText";

interface LocalModelPanelProps {
  readonly settings: AppSettings;
  readonly update: (field: keyof AppSettings, value: string) => void;
}

export default function LocalModelPanel({
  settings,
  update,
}: LocalModelPanelProps) {
  const [checking, setChecking] = useState(false);
  const [state, setState] = useState<ProviderVerifyState | null>(null);

  async function handleCheck() {
    setState("verifying");
    setChecking(true);
    try {
      setState(await verifyProvider(settings.localBaseUrl, checkLocalProvider));
    } finally {
      setChecking(false);
    }
  }

  return (
    <SettingsPanel title="本地模型">
      <label>
        本地服务地址
        <input
          value={asText(settings.localBaseUrl)}
          onChange={(event) => update("localBaseUrl", event.target.value)}
        />
      </label>
      <button type="button" onClick={() => void handleCheck()} disabled={checking}>
        {checking ? "检查中…" : "测试本地连接"}
      </button>
      {state ? <p>{verifyStateMessage("本地", state)}</p> : null}
    </SettingsPanel>
  );
}