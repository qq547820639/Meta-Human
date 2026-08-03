import { invoke } from "@tauri-apps/api/core";

import type { SidecarReadinessSnapshot } from "./types";

interface SidecarConnection {
  readonly baseUrl: string;
  readonly bearerToken: string;
}

interface SafeErrorEnvelope {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly request_id?: string;
  readonly recommended_action?: string;
}

export class SidecarReadinessError extends Error {
  readonly status: number | null;
  readonly code: string;
  readonly retryable: boolean;
  readonly requestId: string | null;
  readonly recommendedAction: string | null;

  constructor({
    status,
    code,
    message,
    retryable,
    requestId = null,
    recommendedAction = null,
  }: {
    status: number | null;
    code: string;
    message: string;
    retryable: boolean;
    requestId?: string | null;
    recommendedAction?: string | null;
  }) {
    super(message);
    this.name = "SidecarReadinessError";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
    this.requestId = requestId;
    this.recommendedAction = recommendedAction;
  }
}

const READY_PATH = "/readyz";
const RUNS_PATH = "/v1/readiness/runs";
export const READINESS_REQUEST_TIMEOUT_MS = 5_000;

export function getSidecarReadinessSnapshot(
  signal?: AbortSignal,
): Promise<SidecarReadinessSnapshot> {
  return requestSidecarReadiness("GET", READY_PATH, [200, 503], signal);
}

export function startOrResumeSidecarReadiness(
  signal?: AbortSignal,
): Promise<SidecarReadinessSnapshot> {
  return requestSidecarReadiness("POST", RUNS_PATH, [202], signal);
}

async function requestSidecarReadiness(
  method: "GET" | "POST",
  path: typeof READY_PATH | typeof RUNS_PATH,
  acceptedStatuses: readonly number[],
  signal?: AbortSignal,
): Promise<SidecarReadinessSnapshot> {
  signal?.throwIfAborted();

  let connection: SidecarConnection;
  try {
    connection = await invoke<SidecarConnection>("get_sidecar_connection");
  } catch (error) {
    throw connectionError(error);
  }

  signal?.throwIfAborted();

  let response: Response;
  try {
    response = await fetchWithTimeout(
      new URL(path, connection.baseUrl).toString(),
      {
        method,
        headers: {
          Authorization: `Bearer ${connection.bearerToken}`,
        },
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
      },
      signal,
    );
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    if (isTimeoutError(error)) {
      throw timeoutError();
    }
    throw unavailableError();
  }

  if (!acceptedStatuses.includes(response.status)) {
    throw await errorFromResponse(response);
  }

  try {
    return (await response.json()) as SidecarReadinessSnapshot;
  } catch {
    throw new SidecarReadinessError({
      status: response.status,
      code: "invalid_readiness_response",
      message: "The readiness service returned an invalid response.",
      retryable: true,
    });
  }
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  callerSignal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) {
    controller.abort(callerSignal.reason);
  } else {
    callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
  }

  const timer = setTimeout(() => {
    controller.abort(
      new DOMException("Readiness request timed out.", "TimeoutError"),
    );
  }, READINESS_REQUEST_TIMEOUT_MS);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", abortFromCaller);
  }
}

async function errorFromResponse(
  response: Response,
): Promise<SidecarReadinessError> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  const envelope = parseSafeEnvelope(body);
  if (!envelope) {
    return new SidecarReadinessError({
      status: response.status,
      code: "readiness_request_failed",
      message: "The readiness request could not be completed.",
      retryable: response.status >= 500,
    });
  }

  return new SidecarReadinessError({
    status: response.status,
    code: envelope.code,
    message: envelope.message,
    retryable: envelope.retryable,
    requestId: envelope.request_id ?? null,
    recommendedAction: envelope.recommended_action ?? null,
  });
}

function parseSafeEnvelope(value: unknown): SafeErrorEnvelope | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    typeof value.code !== "string" ||
    typeof value.message !== "string" ||
    typeof value.retryable !== "boolean"
  ) {
    return null;
  }
  if (
    value.request_id !== undefined &&
    typeof value.request_id !== "string"
  ) {
    return null;
  }
  if (
    value.recommended_action !== undefined &&
    typeof value.recommended_action !== "string"
  ) {
    return null;
  }

  return {
    code: value.code,
    message: value.message,
    retryable: value.retryable,
    request_id: value.request_id,
    recommended_action: value.recommended_action,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAbortError(error: unknown): boolean {
  return isRecord(error) && error.name === "AbortError";
}

function unavailableError(): SidecarReadinessError {
  return new SidecarReadinessError({
    status: null,
    code: "readiness_unavailable",
    message: "The readiness service is unavailable.",
    retryable: true,
  });
}

function connectionError(error: unknown): SidecarReadinessError {
  const message =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : "";
  if (message.includes("failed closed")) {
    return new SidecarReadinessError({
      status: null,
      code: "readiness_failed_closed",
      message:
        "The readiness service stopped and requires an app restart.",
      retryable: false,
    });
  }
  return unavailableError();
}

function timeoutError(): SidecarReadinessError {
  return new SidecarReadinessError({
    status: null,
    code: "readiness_timeout",
    message: "The readiness request timed out.",
    retryable: true,
  });
}

function isTimeoutError(error: unknown): boolean {
  return isRecord(error) && error.name === "TimeoutError";
}
