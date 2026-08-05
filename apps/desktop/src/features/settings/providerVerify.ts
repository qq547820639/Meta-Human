import type { KnowledgeSource } from "../knowledge/knowledgeClient";
import type { ProviderVerification } from "./settingsClient";

/**
 * Provider/environment verification states.
 *
 * The sidecar backend now exposes a unified provider deep-verification endpoint
 * (POST /v1/providers/verify) whose result can be mapped onto these states via
 * `mapDeepVerification` (see below). The states produced by the shallow checks
 * (verifyProvider / verifyProviderDetail / verifyFeishu) are: unconfigured,
 * verifying, verified, network_unreachable, and configured_unverified. The
 * remaining states (credential/permission/model/space/API-version failures)
 * are populated from the deep verification result rather than fabricated from
 * shallow field checks.
 */
export type ProviderVerifyState =
  | "unconfigured"
  | "configured_unverified"
  | "verifying"
  | "verified"
  | "network_unreachable"
  | "invalid_credentials"
  | "credentials_expired"
  | "insufficient_permission"
  | "model_not_found"
  | "space_not_found"
  | "api_version_incompatible";

export const providerVerifyLabels: Record<ProviderVerifyState, string> = {
  unconfigured: "未配置",
  configured_unverified: "已配置但未验证",
  verifying: "正在验证",
  verified: "验证成功",
  network_unreachable: "网络不可达",
  invalid_credentials: "凭证无效",
  credentials_expired: "凭证过期",
  insufficient_permission: "权限不足",
  model_not_found: "模型不存在",
  space_not_found: "Space ID 不存在",
  api_version_incompatible: "API 版本不兼容",
};

export type ProviderCheck = (url: string) => Promise<boolean>;

/**
 * Runs a real reachability check for a provider and maps the result to a
 * verification state. Returns "unconfigured" when no URL is provided, and
 * never claims success unless the underlying check returned true.
 */
export async function verifyProvider(
  url: string | null | undefined,
  check: ProviderCheck,
): Promise<ProviderVerifyState> {
  const trimmed = url?.trim();
  if (!trimmed) return "unconfigured";
  try {
    const reachable = await check(trimmed);
    return reachable ? "verified" : "network_unreachable";
  } catch {
    return "network_unreachable";
  }
}

export interface ProviderVerifyDetail {
  readonly state: ProviderVerifyState;
  readonly url: string;
  readonly providerType: "local" | "remote";
  readonly latencyMs: number;
  /** The exact step that was checked/failed: "ok", "connection", "unconfigured". */
  readonly step: string;
  readonly detail?: string;
}

/**
 * Like verifyProvider but returns a structured result carrying the actual
 * connection target, provider type, measured latency and the failing step so
 * the UI can show exactly what was checked. Never claims success unless the
 * underlying check returned true.
 */
export async function verifyProviderDetail(
  url: string | null | undefined,
  check: ProviderCheck,
  providerType: "local" | "remote",
): Promise<ProviderVerifyDetail> {
  const trimmed = url?.trim();
  if (!trimmed) {
    return {
      state: "unconfigured",
      url: "",
      providerType,
      latencyMs: 0,
      step: "unconfigured",
      detail: "未填写服务地址。",
    };
  }
  const startedAt = performance.now();
  let reachable: boolean;
  try {
    reachable = await check(trimmed);
  } catch {
    reachable = false;
  }
  const latencyMs = performance.now() - startedAt;
  if (reachable) {
    return { state: "verified", url: trimmed, providerType, latencyMs, step: "ok" };
  }
  return {
    state: "network_unreachable",
    url: trimmed,
    providerType,
    latencyMs,
    step: "connection",
    detail: "无法连接到服务地址，请检查网络、服务是否运行以及地址是否正确。",
  };
}

/**
 * Human-readable label for the failed/checked step of a provider verification.
 */
export function providerVerifyDetailStepLabel(step: string): string {
  switch (step) {
    case "ok":
      return "全部检查通过";
    case "connection":
      return "连接服务";
    case "unconfigured":
      return "未配置地址";
    default:
      return step;
  }
}

export type FeishuVerifyStepStatus =
  | "pass"
  | "fail"
  | "not_available"
  | "checking";

export interface FeishuVerifyStep {
  readonly id: string;
  readonly label: string;
  readonly status: FeishuVerifyStepStatus;
  readonly detail?: string;
}

export interface FeishuVerifyInput {
  readonly appId: string;
  readonly appSecretSet: boolean;
  readonly accessTokenSet: boolean;
  readonly spaceId: string;
  readonly listSources: () => Promise<KnowledgeSource[]>;
}

/**
 * Stepwise Feishu verification. The first steps check the real configuration
 * presence. The document-list step performs a real backend call
 * (listKnowledgeSources hits /v1/knowledge/sources), and the read step reports
 * whether at least one document is known to have been read. The backend has no
 * richer verification endpoint, so these last two steps are deliberately
 * driven by the real data source rather than pretending a fresh read happened.
 */
export async function verifyFeishu(
  input: FeishuVerifyInput,
): Promise<FeishuVerifyStep[]> {
  const steps: FeishuVerifyStep[] = [
    {
      id: "app_id",
      label: "应用 App ID",
      status: input.appId.trim() ? "pass" : "fail",
      detail: input.appId.trim() ? undefined : "未填写应用 App ID。",
    },
    {
      id: "app_secret",
      label: "应用 App Secret",
      status: input.appSecretSet ? "pass" : "fail",
      detail: input.appSecretSet ? undefined : "未配置应用 App Secret。",
    },
    {
      id: "access_token",
      label: "Access Token",
      status: input.accessTokenSet ? "pass" : "fail",
      detail: input.accessTokenSet ? undefined : "未配置 Access Token。",
    },
    {
      id: "space_id",
      label: "知识空间 ID",
      status: input.spaceId.trim() ? "pass" : "fail",
      detail: input.spaceId.trim() ? undefined : "未填写知识空间 ID。",
    },
  ];
  try {
    const sources = await input.listSources();
    steps.push({
      id: "doc_list",
      label: "读取文档列表",
      status: "pass",
      detail: `已读取到 ${sources.length} 份文档。`,
    });
    steps.push({
      id: "doc_read",
      label: "至少一份文档可读取",
      status: sources.length > 0 ? "pass" : "fail",
      detail:
        sources.length > 0
          ? "知识库存在已同步文档，说明文档曾成功读取。"
          : "知识库为空，没有可读取的文档。",
    });
  } catch {
    steps.push({
      id: "doc_list",
      label: "读取文档列表",
      status: "fail",
      detail: "读取文档列表失败，可能是网络不可达或凭证无效。",
    });
    steps.push({
      id: "doc_read",
      label: "至少一份文档可读取",
      status: "fail",
      detail: "无法读取文档列表，因此无法验证文档读取。",
    });
  }
  return steps;
}

/**
 * Maps the stepwise Feishu result to an overall verification state. This is the
 * shallow path. For richer, per-step results the panel can also call the
 * unified deep-verification endpoint and map it with `mapDeepVerification`.
 * Because the shallow path cannot fully verify Feishu, it never returns
 * "verified" — the honest ceiling is "configured_unverified".
 */
export function feishuStepsToState(
  steps: FeishuVerifyStep[],
): ProviderVerifyState {
  const appId = steps.find((step) => step.id === "app_id");
  if (appId?.status === "fail") return "unconfigured";
  const docList = steps.find((step) => step.id === "doc_list");
  if (docList?.status === "fail") return "network_unreachable";
  return "configured_unverified";
}

/**
 * Maps a unified provider deep-verification result to a `ProviderVerifyState`.
 *
 * Direct status mappings: "ok" → "verified", "unconfigured" → "unconfigured".
 * For "failed" the state is derived from the structured fields:
 *  - auth failure (invalid_credentials / not_configured) → "invalid_credentials"
 *  - permission failure (insufficient_permission)       → "insufficient_permission"
 *  - model not found (model_exists === false)            → "model_not_found"
 *  - network unreachable (network_reachable === false or current_step "connection")
 *                                                        → "network_unreachable"
 *  - otherwise                                           → "configured_unverified"
 */
export function mapDeepVerification(
  verification: ProviderVerification,
): ProviderVerifyState {
  if (verification.status === "ok") return "verified";
  if (verification.status === "unconfigured") return "unconfigured";
  if (
    verification.auth_status === "invalid_credentials" ||
    verification.auth_status === "not_configured"
  ) {
    return "invalid_credentials";
  }
  if (verification.permission_status === "insufficient_permission") {
    return "insufficient_permission";
  }
  if (verification.model_exists === false) return "model_not_found";
  if (
    verification.network_reachable === false ||
    verification.current_step === "connection"
  ) {
    return "network_unreachable";
  }
  return "configured_unverified";
}

export function verifyStateMessage(
  prefix: string,
  state: ProviderVerifyState,
): string {
  switch (state) {
    case "unconfigured":
      return `请先填写${prefix}服务地址。`;
    case "verifying":
      return `正在检查${prefix}服务…`;
    case "verified":
      return `${prefix}服务连接正常（验证成功）。`;
    case "network_unreachable":
      return `${prefix}服务网络不可达。`;
    default:
      return `${prefix}服务${providerVerifyLabels[state]}。`;
  }
}