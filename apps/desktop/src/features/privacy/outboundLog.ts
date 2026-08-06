/**
 * Data outbound (出境) log + remote resource deletion tracking.
 *
 * Records every exchange that moves data toward a remote destination so the
 * user can later audit what left the local boundary. Also tracks remote
 * resources that were created in the cloud and must be explicitly deleted,
 * with a backoff retry plan for deletion requests.
 */

import type { ProviderName } from "./providerPrivacy";
import type { DataKind } from "./dataFlow";

/** A record of one outbound (data leaving the local boundary) event. */
export interface DataOutboundRecord {
  readonly id: string;
  readonly provider: ProviderName;
  readonly kinds: readonly DataKind[];
  readonly sizeBytes: number;
  readonly atMs: number;
  readonly destination: string;
}

export type OutboundLog = readonly DataOutboundRecord[];

export interface OutboundFilter {
  readonly provider?: ProviderName;
  readonly kind?: DataKind;
}

/** Extract the host portion of a destination URL / host:port / resource. */
function hostOf(destination: string): string {
  if (/^local:\/\//i.test(destination)) {
    return "local";
  }
  const withoutScheme = destination.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, "");
  return withoutScheme.split(/[/:]/)[0].toLowerCase();
}

/** True when `destination` is a loopback / local target (stays on machine). */
export function isLocalDestination(destination: string): boolean {
  const host = hostOf(destination);
  if (host === "localhost" || host === "local") {
    return true;
  }
  if (/^127\./.test(host) || host === "::1") {
    return true;
  }
  return false;
}

/** True when the record's data left the local boundary. */
export function dataExitedLocalBoundary(record: DataOutboundRecord): boolean {
  return !isLocalDestination(record.destination);
}

export function appendOutbound(
  log: OutboundLog,
  record: DataOutboundRecord,
): OutboundLog {
  return [...log, record];
}

export function listOutbound(
  log: OutboundLog,
  filter?: OutboundFilter,
): OutboundLog {
  if (!filter) {
    return log;
  }
  return log.filter((record) => {
    if (filter.provider !== undefined && record.provider !== filter.provider) {
      return false;
    }
    if (
      filter.kind !== undefined &&
      !record.kinds.includes(filter.kind)
    ) {
      return false;
    }
    return true;
  });
}

export type DeleteStatus = "pending" | "requested" | "confirmed" | "retrying";

/** A resource living on a remote provider that may need deletion. */
export interface RemoteResource {
  readonly id: string;
  readonly provider: ProviderName;
  readonly kind: DataKind;
  readonly createdAtMs: number;
  readonly deleteRequested: boolean;
  /** Number of (re)attempts issued so far. 0 = not yet retried. */
  readonly deleteAttempts: number;
  readonly deleteConfirmed: boolean;
}

export function deleteStatus(resource: RemoteResource): DeleteStatus {
  if (resource.deleteConfirmed) {
    return "confirmed";
  }
  if (!resource.deleteRequested) {
    return "pending";
  }
  return resource.deleteAttempts > 0 ? "retrying" : "requested";
}

export function requestDelete(resource: RemoteResource): RemoteResource {
  return {
    ...resource,
    deleteRequested: true,
    deleteAttempts: 0,
    deleteConfirmed: false,
  };
}

export function retryDelete(resource: RemoteResource): RemoteResource {
  return {
    ...resource,
    deleteRequested: true,
    deleteAttempts: resource.deleteAttempts + 1,
    deleteConfirmed: false,
  };
}

export interface DeleteRetryPlanInput {
  readonly attempted: number;
  readonly maxAttempts: number;
  readonly backoffMs: number;
  readonly nowMs: number;
  readonly lastAttemptAtMs: number;
}

export interface DeleteRetryPlan {
  /** Whether a retry should happen now. */
  readonly retry: boolean;
  /** When the next attempt may run (null when attempts are exhausted). */
  readonly nextAttemptAtMs: number | null;
}

export function planDeleteRetry(input: DeleteRetryPlanInput): DeleteRetryPlan {
  if (input.attempted >= input.maxAttempts) {
    return { retry: false, nextAttemptAtMs: null };
  }
  const nextAttemptAtMs = input.lastAttemptAtMs + input.backoffMs;
  return {
    retry: input.nowMs >= nextAttemptAtMs,
    nextAttemptAtMs,
  };
}