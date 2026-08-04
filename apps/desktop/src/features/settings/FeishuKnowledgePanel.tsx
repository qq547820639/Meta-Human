import { useState } from "react";

import SettingsPanel from "./SettingsPanel";
import {
  FeishuVerifyStep,
  feishuStepsToState,
  providerVerifyLabels,
  verifyFeishu,
} from "./providerVerify";
import {
  exchangeFeishuCode,
  openFeishuAuthorization,
  startFeishuOauth,
} from "./settingsClient";
import type { AppSettings, SecretKind, SecretFlags } from "./settingsClient";
import { listKnowledgeSources } from "../knowledge/knowledgeClient";
import type { KnowledgeSource } from "../knowledge/knowledgeClient";
import { asText } from "./settingsText";

const feishuRedirectUri = "http://127.0.0.1:1420/oauth/feishu";

interface FeishuKnowledgePanelProps {
  readonly settings: AppSettings;
  readonly update: (field: keyof AppSettings, value: string) => void;
  readonly secretFlags: Pick<
    SecretFlags,
    "feishuAppSecretSet" | "feishuAccessTokenSet" | "feishuRefreshTokenSet"
  >;
  readonly feishuAppSecret: string;
  readonly setFeishuAppSecret: (value: string) => void;
  readonly feishuAccessToken: string;
  readonly setFeishuAccessToken: (value: string) => void;
  readonly feishuRefreshToken: string;
  readonly setFeishuRefreshToken: (value: string) => void;
  readonly onClearSecret: (kind: SecretKind) => void;
  readonly knowledgeSources: KnowledgeSource[];
  readonly sourcesLoading: boolean;
  readonly sourcesError: string | null;
  readonly confirmingSourceId: string | null;
  readonly onDeleteSource: (source: KnowledgeSource) => void;
  readonly onOpenDelete: (source: KnowledgeSource) => void;
  readonly onCloseDelete: () => void;
}

function stepLabel(step: FeishuVerifyStep): string {
  switch (step.status) {
    case "pass":
      return "通过";
    case "fail":
      return "失败";
    case "not_available":
      return "未验证";
    case "checking":
      return "检查中";
  }
}

export default function FeishuKnowledgePanel({
  settings,
  update,
  secretFlags,
  feishuAppSecret,
  setFeishuAppSecret,
  feishuAccessToken,
  setFeishuAccessToken,
  feishuRefreshToken,
  setFeishuRefreshToken,
  onClearSecret,
  knowledgeSources,
  sourcesLoading,
  sourcesError,
  confirmingSourceId,
  onDeleteSource,
  onOpenDelete,
  onCloseDelete,
}: FeishuKnowledgePanelProps) {
  const [feishuCode, setFeishuCode] = useState("");
  const [oauthStatus, setOauthStatus] = useState<string | null>(null);
  const [verifySteps, setVerifySteps] = useState<FeishuVerifyStep[]>([]);
  const [verifying, setVerifying] = useState(false);

  async function handleOpenAuthorization() {
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

  async function handleExchangeCode() {
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

  async function handleStartOauth() {
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

  async function handleVerify() {
    setVerifying(true);
    setVerifySteps([]);
    try {
      const steps = await verifyFeishu({
        appId: settings.feishuAppId ?? "",
        appSecretSet:
          secretFlags.feishuAppSecretSet || feishuAppSecret.trim() !== "",
        accessTokenSet:
          secretFlags.feishuAccessTokenSet || feishuAccessToken.trim() !== "",
        spaceId: settings.feishuSpaceId ?? "",
        listSources: listKnowledgeSources,
      });
      setVerifySteps(steps);
    } finally {
      setVerifying(false);
    }
  }

  const overallState = verifySteps.length > 0 ? feishuStepsToState(verifySteps) : null;

  return (
    <SettingsPanel title="飞书知识库">
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
          placeholder={secretFlags.feishuAppSecretSet ? "已保存，留空表示不修改" : ""}
          onChange={(event) => setFeishuAppSecret(event.target.value)}
        />
      </label>
      {secretFlags.feishuAppSecretSet ? (
        <button type="button" onClick={() => onClearSecret("feishuAppSecret")}>
          清除已保存的 App Secret
        </button>
      ) : null}
      <label>
        Access Token
        <input
          type="password"
          value={feishuAccessToken}
          placeholder={secretFlags.feishuAccessTokenSet ? "已保存，留空表示不修改" : ""}
          onChange={(event) => setFeishuAccessToken(event.target.value)}
        />
      </label>
      {secretFlags.feishuAccessTokenSet ? (
        <button type="button" onClick={() => onClearSecret("feishuAccessToken")}>
          清除已保存的 Access Token
        </button>
      ) : null}
      {secretFlags.feishuRefreshTokenSet ? (
        <button type="button" onClick={() => onClearSecret("feishuRefreshToken")}>
          清除已保存的 Refresh Token
        </button>
      ) : null}
      <button type="button" onClick={() => void handleStartOauth()}>
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
        <button type="button" onClick={() => void handleOpenAuthorization()}>
          打开飞书授权页面
        </button>
        <label>
          授权码
          <input
            value={feishuCode}
            onChange={(event) => setFeishuCode(event.target.value)}
          />
        </label>
        <button type="button" onClick={() => void handleExchangeCode()}>
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

      <button type="button" onClick={() => void handleVerify()} disabled={verifying}>
        {verifying ? "验证中…" : "验证飞书配置"}
      </button>
      {verifying ? <p role="status">正在验证飞书配置…</p> : null}
      {overallState ? (
        <p aria-label="飞书验证状态">
          飞书总状态：{providerVerifyLabels[overallState]}
        </p>
      ) : null}
      {verifySteps.length > 0 ? (
        <ul aria-label="飞书验证步骤">
          {verifySteps.map((step) => (
            <li key={step.id}>
              <span>{step.label}</span> · <span>{stepLabel(step)}</span>
              {step.detail ? <p>{step.detail}</p> : null}
            </li>
          ))}
        </ul>
      ) : null}

      <p>知识来源</p>
      {sourcesLoading ? <p role="status">正在读取知识来源…</p> : null}
      {sourcesError ? <p role="alert">{sourcesError}</p> : null}
      {knowledgeSources.length === 0 && !sourcesLoading ? (
        <p>还没有同步的知识来源。</p>
      ) : (
        <ul aria-label="知识来源列表">
          {knowledgeSources.map((source) => (
            <li key={source.documentId}>
              {source.title} · {source.chunkCount} 段
              {source.sourceUrl ? (
                <a href={source.sourceUrl} target="_blank" rel="noreferrer">
                  打开
                </a>
              ) : null}
              <button
                type="button"
                onClick={() => onOpenDelete(source)}
              >
                删除
              </button>
            </li>
          ))}
        </ul>
      )}
      {confirmingSourceId !== null ? (
        (() => {
          const target = knowledgeSources.find(
            (source) => source.documentId === confirmingSourceId,
          );
          return (
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="delete-source-dialog-title"
              className="conversation-modal"
            >
              <h2 id="delete-source-dialog-title">删除知识来源</h2>
              <p>
                确认删除「{target?.title ?? confirmingSourceId}」？此操作不可撤销。
              </p>
              <button type="button" onClick={onCloseDelete}>
                取消
              </button>
              {target ? (
                <button type="button" onClick={() => onDeleteSource(target)}>
                  确认删除
                </button>
              ) : null}
            </div>
          );
        })()
      ) : null}
    </SettingsPanel>
  );
}