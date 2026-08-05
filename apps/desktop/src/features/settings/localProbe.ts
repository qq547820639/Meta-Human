/**
 * Local service auto-detection and model discovery.
 *
 * Probes the common Ollama / LM Studio addresses by calling the OpenAI-compatible
 * /v1/models endpoint directly. The app CSP allows connect-src to
 * http://127.0.0.1:* so these loopback fetches are permitted in the webview.
 * A service is only considered reachable when /v1/models actually answered;
 * the UI never fabricates a reachable result.
 */

import { classifyProbeErrorCode } from "./errorTranslation";

export type LocalServiceKind = "ollama" | "lmstudio" | "generic";

export interface DiscoveredModel {
  readonly id: string;
  readonly name: string;
}

export interface LocalServiceProbe {
  readonly baseUrl: string;
  readonly kind: LocalServiceKind;
  readonly label: string;
  /** True only when /v1/models answered successfully. */
  readonly reachable: boolean;
  readonly models: readonly DiscoveredModel[];
  /** Stable error code when unreachable (e.g. "connection_refused", "http_404"). */
  readonly error?: string;
}

/** Common local OpenAI-compatible endpooints probed by default. */
export const DEFAULT_PROBE_CANDIDATES: readonly string[] = [
  "http://127.0.0.1:11434", // Ollama
  "http://127.0.0.1:1234", // LM Studio
];

export interface LocalProbeOptions {
  readonly candidates?: readonly string[];
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

export function trimUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export function kindForBaseUrl(baseUrl: string): LocalServiceKind {
  const portMatch = /:(\d+)$/.exec(trimUrl(baseUrl));
  const port = portMatch ? Number(portMatch[1]) : 0;
  if (port === 11434) return "ollama";
  if (port === 1234) return "lmstudio";
  return "generic";
}

export function serviceLabelForUrl(baseUrl: string): string {
  const kind = kindForBaseUrl(baseUrl);
  const suffix =
    kind === "ollama" ? "（Ollama）" : kind === "lmstudio" ? "（LM Studio）" : "（兼容服务）";
  return `${trimUrl(baseUrl)}${suffix}`;
}

export interface FetchModelsResult {
  readonly models: readonly DiscoveredModel[];
  readonly error: string | null;
}

export async function fetchModelsRaw(
  baseUrl: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<FetchModelsResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${trimUrl(baseUrl)}/v1/models`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      return { models: [], error: `http_${response.status}` };
    }
    const body = (await response.json()) as {
      data?: Array<{ id?: unknown }>;
    };
    const data = Array.isArray(body.data) ? body.data : [];
    const models = (data as Array<{ id?: unknown }>)
      .filter((item) => typeof item.id === "string" && item.id.trim().length > 0)
      .map((item) => {
        const id = (item.id as string).trim();
        return { id, name: id };
      });
    return { models, error: null };
  } catch (error) {
    return { models: [], error: classifyProbeErrorCode(error) };
  } finally {
    clearTimeout(timer);
  }
}

export async function probeLocalServices(
  options: LocalProbeOptions = {},
): Promise<LocalServiceProbe[]> {
  const candidates = options.candidates ?? DEFAULT_PROBE_CANDIDATES;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 2500;
  const results = await Promise.all(
    candidates.map(async (baseUrl) => {
      const result = await fetchModelsRaw(baseUrl, fetchImpl, timeoutMs);
      return {
        baseUrl,
        kind: kindForBaseUrl(baseUrl),
        label: serviceLabelForUrl(baseUrl),
        reachable: result.error === null,
        models: result.models,
        error: result.error ?? undefined,
      } satisfies LocalServiceProbe;
    }),
  );
  return results;
}
