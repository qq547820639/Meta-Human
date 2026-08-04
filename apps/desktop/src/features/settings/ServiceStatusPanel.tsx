import { useState } from "react";

import SettingsPanel from "./SettingsPanel";
import { checkLocalProvider, checkRemoteProvider } from "./settingsClient";
import type { AppSettings } from "./settingsClient";

interface ServiceStatusPanelProps {
  readonly settings: AppSettings;
  readonly feishuAccessTokenSet: boolean;
  readonly feishuAccessToken: string;
}

export default function ServiceStatusPanel({
  settings,
  feishuAccessTokenSet,
  feishuAccessToken,
}: ServiceStatusPanelProps) {
  const [checking, setChecking] = useState(false);
  const [checkSummary, setCheckSummary] = useState<{
    local: string;
    remote: string;
    feishu: string;
  } | null>(null);

  async function handleRunChecks() {
    setChecking(true);
    const localUrl = settings.localBaseUrl?.trim();
    const remoteUrl = settings.remoteBaseUrl?.trim();
    const feishuConfigured = Boolean(
      settings.feishuAppId?.trim() &&
        settings.feishuSpaceId?.trim() &&
        (feishuAccessTokenSet || feishuAccessToken.trim()),
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

  return (
    <SettingsPanel title="服务状态">
      <button type="button" onClick={() => void handleRunChecks()} disabled={checking}>
        {checking ? "检查中…" : "一键检查连接"}
      </button>
      {checkSummary ? (
        <ul aria-label="连接检查结果">
          <li>本地模型：{checkSummary.local}</li>
          <li>远程 GPU：{checkSummary.remote}</li>
          <li>飞书知识：{checkSummary.feishu}</li>
        </ul>
      ) : null}
    </SettingsPanel>
  );
}