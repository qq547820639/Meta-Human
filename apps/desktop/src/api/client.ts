import { invoke } from "@tauri-apps/api/core";

interface SidecarConnection {
  readonly baseUrl: string;
  readonly bearerToken: string;
}

/**
 * Error envelope contract shared with the sidecar. Mirrors the backend
 * `ErrorEnvelope` in `voxstudio_core/errors.py`.
 */
export interface ApiErrorEnvelope {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly request_id: string;
  readonly recommended_action?: string | null;
  readonly technical_message?: string | null;
  readonly details?: Record<string, unknown> | null;
  readonly provider?: string | null;
  readonly provider_status?: string | null;
  readonly timestamp?: string | null;
}

export interface ApiRequestOptions {
  readonly method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  readonly path: string;
  readonly body?: unknown;
  readonly signal?: AbortSignal;
  readonly query?: Record<string, string | number | boolean | undefined>;
}

/**
 * A typed error thrown by the unified API client. The user-facing message and
 * the technical details are kept separate so the UI can show a friendly
 * message while still allowing the user to copy the request id.
 */
export class ApiError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly requestId: string;
  readonly recommendedAction: string | null;
  readonly technicalMessage: string | null;
  readonly details: Record<string, unknown> | null;
  readonly provider: string | null;
  readonly providerStatus: string | null;

  constructor(
    envelope: ApiErrorEnvelope,
    readonly status: number,
  ) {
    super(envelope.message);
    this.name = "ApiError";
    this.code = envelope.code;
    this.retryable = envelope.retryable;
    this.requestId = envelope.request_id;
    this.recommendedAction = envelope.recommended_action ?? null;
    this.technicalMessage = envelope.technical_message ?? null;
    this.details = envelope.details ?? null;
    this.provider = envelope.provider ?? null;
    this.providerStatus = envelope.provider_status ?? null;
  }
}

let cachedConnection: SidecarConnection | null = null;

async function connection(): Promise<SidecarConnection> {
  if (cachedConnection !== null) {
    return cachedConnection;
  }
  cachedConnection = await invoke<SidecarConnection>("get_sidecar_connection");
  return cachedConnection;
}

function buildUrl(
  baseUrl: string,
  path: string,
  query?: ApiRequestOptions["query"],
): string {
  const url = new URL(path, baseUrl);
  if (query !== undefined) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
}

async function parseEnvelope(
  text: string,
  fallbackStatus: number,
): Promise<ApiErrorEnvelope> {
  try {
    const parsed = JSON.parse(text) as Partial<ApiErrorEnvelope>;
    if (typeof parsed.code === "string" && typeof parsed.message === "string") {
      return {
        code: parsed.code,
        message: parsed.message,
        retryable: parsed.retryable ?? false,
        request_id: parsed.request_id ?? "",
        recommended_action: parsed.recommended_action ?? null,
        technical_message: parsed.technical_message ?? null,
        details: parsed.details ?? null,
        provider: parsed.provider ?? null,
        provider_status: parsed.provider_status ?? null,
        timestamp: parsed.timestamp ?? null,
      };
    }
  } catch {
    // Fall through to the generic envelope below.
  }
  return {
    code: "request_failed",
    message: "请求失败，请稍后重试。",
    retryable: true,
    request_id: "",
    ...(fallbackStatus >= 500 ? { provider_status: "unavailable" } : {}),
  };
}

/**
 * Performs a JSON request against the sidecar and parses the unified error
 * protocol. Throws an `ApiError` on non-2xx responses.
 */
export async function apiRequest<T>(
  options: ApiRequestOptions,
): Promise<T> {
  const conn = await connection();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${conn.bearerToken}`,
  };
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(buildUrl(conn.baseUrl, options.path, options.query), {
    method: options.method ?? "GET",
    headers,
    ...(options.body !== undefined
      ? { body: JSON.stringify(options.body) }
      : {}),
    credentials: "omit",
    cache: "no-store",
    signal: options.signal,
  });

  if (!response.ok) {
    const text = await response.text();
    const envelope = await parseEnvelope(text, response.status);
    const requestId =
      envelope.request_id !== ""
        ? envelope.request_id
        : (response.headers.get("x-request-id") ?? "");
    throw new ApiError(
      { ...envelope, request_id: requestId },
      response.status,
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

/** Copies the request id of an `ApiError` to the clipboard, if available. */
export async function copyRequestId(error: ApiError): Promise<boolean> {
  if (!error.requestId) {
    return false;
  }
  try {
    await navigator.clipboard.writeText(error.requestId);
    return true;
  } catch {
    return false;
  }
}

/** Clears the cached sidecar connection, e.g. after a sidecar restart. */
export function resetSidecarConnection(): void {
  cachedConnection = null;
}