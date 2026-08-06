import { describe, expect, it } from "vitest";

import {
  appendOutbound,
  dataExitedLocalBoundary,
  deleteStatus,
  isLocalDestination,
  listOutbound,
  planDeleteRetry,
  requestDelete,
  retryDelete,
} from "./outboundLog";
import type { DataOutboundRecord, RemoteResource } from "./outboundLog";

const remoteRecord: DataOutboundRecord = {
  id: "r1",
  provider: "remote",
  kinds: ["audio"],
  sizeBytes: 1024,
  atMs: 1000,
  destination: "https://api.remote.example",
};

const localRecord: DataOutboundRecord = {
  id: "l1",
  provider: "local",
  kinds: ["text"],
  sizeBytes: 64,
  atMs: 2000,
  destination: "http://127.0.0.1:11434",
};

function resource(overrides: Partial<RemoteResource> = {}): RemoteResource {
  return {
    id: "res1",
    provider: "remote",
    kind: "audio",
    createdAtMs: 0,
    deleteRequested: false,
    deleteAttempts: 0,
    deleteConfirmed: false,
    ...overrides,
  };
}

describe("outboundLog", () => {
  it("detects the local boundary by destination", () => {
    expect(isLocalDestination("http://127.0.0.1:11434")).toBe(true);
    expect(isLocalDestination("localhost:1234")).toBe(true);
    expect(isLocalDestination("https://api.remote.example")).toBe(false);
    expect(dataExitedLocalBoundary(remoteRecord)).toBe(true);
    expect(dataExitedLocalBoundary(localRecord)).toBe(false);
  });

  it("appends and lists outbound records", () => {
    const log = appendOutbound([], remoteRecord);
    const withLocal = appendOutbound(log, localRecord);
    expect(withLocal).toHaveLength(2);
    expect(withLocal[0]).toEqual(remoteRecord);
  });

  it("filters by provider and kind", () => {
    const log = appendOutbound(appendOutbound([], remoteRecord), localRecord);
    expect(listOutbound(log, { provider: "remote" })).toEqual([remoteRecord]);
    expect(listOutbound(log, { kind: "text" })).toEqual([localRecord]);
    expect(listOutbound(log)).toHaveLength(2);
    expect(listOutbound(log, { provider: "local", kind: "audio" })).toEqual([]);
  });
});

describe("delete lifecycle", () => {
  it("moves from pending to requested to confirmed", () => {
    const pending = resource();
    expect(deleteStatus(pending)).toBe("pending");

    const requested = requestDelete(pending);
    expect(requested.deleteRequested).toBe(true);
    expect(deleteStatus(requested)).toBe("requested");

    const confirmed = { ...requested, deleteConfirmed: true };
    expect(deleteStatus(confirmed)).toBe("confirmed");
  });

  it("retry bumps attempts and reports retrying", () => {
    const requested = requestDelete(resource());
    const retried = retryDelete(requested);
    expect(retried.deleteAttempts).toBe(1);
    expect(deleteStatus(retried)).toBe("retrying");
  });
});

describe("planDeleteRetry", () => {
  it("retries only after the backoff window and before max attempts", () => {
    const plan = planDeleteRetry({
      attempted: 1,
      maxAttempts: 3,
      backoffMs: 1000,
      nowMs: 3000,
      lastAttemptAtMs: 2000,
    });
    expect(plan.retry).toBe(true);
    expect(plan.nextAttemptAtMs).toBe(3000);
  });

  it("does not retry before the backoff window", () => {
    const plan = planDeleteRetry({
      attempted: 1,
      maxAttempts: 3,
      backoffMs: 5000,
      nowMs: 3000,
      lastAttemptAtMs: 2000,
    });
    expect(plan.retry).toBe(false);
    expect(plan.nextAttemptAtMs).toBe(7000);
  });

  it("stops retrying at max attempts", () => {
    const plan = planDeleteRetry({
      attempted: 3,
      maxAttempts: 3,
      backoffMs: 1000,
      nowMs: 999_999,
      lastAttemptAtMs: 0,
    });
    expect(plan.retry).toBe(false);
    expect(plan.nextAttemptAtMs).toBeNull();
  });
});