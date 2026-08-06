import { describe, expect, it } from "vitest";

import {
  createDedupeGuard,
  recoverUnfinishedMessages,
} from "./messageRecovery";

interface Msg {
  id: string;
  status: string;
}

const msg = (id: string, status: string): Msg => ({ id, status });

describe("recoverUnfinishedMessages", () => {
  it("marks in-flight unfinished messages as pending_retry", () => {
    const store = [
      msg("m1", "processing"),
      msg("m2", "pending"),
      msg("m3", "done"),
    ];
    const { recovered, store: next } = recoverUnfinishedMessages(store, {
      inFlightIds: new Set(["m1", "m2"]),
    });

    expect(recovered.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(recovered.every((m) => m.status === "pending_retry")).toBe(true);

    const byId = new Map(next.map((m) => [m.id, m]));
    expect(byId.get("m1")?.status).toBe("pending_retry");
    expect(byId.get("m2")?.status).toBe("pending_retry");
    expect(byId.get("m3")?.status).toBe("done");
  });

  it("does not touch terminal messages even if in flight", () => {
    const store = [msg("m1", "failed"), msg("m2", "cancelled"), msg("m3", "done")];
    const { recovered, store: next } = recoverUnfinishedMessages(store, {
      inFlightIds: new Set(["m1", "m2", "m3"]),
    });
    expect(recovered).toEqual([]);
    expect(next.map((m) => m.status)).toEqual(["failed", "cancelled", "done"]);
  });

  it("does not re-mark an already pending_retry message", () => {
    const store = [msg("m1", "pending_retry")];
    const { recovered, store: next } = recoverUnfinishedMessages(store, {
      inFlightIds: new Set(["m1"]),
    });
    expect(recovered).toEqual([]);
    expect(next[0].status).toBe("pending_retry");
  });

  it("leaves unfinished messages that were not in flight untouched", () => {
    const store = [msg("m1", "pending")];
    const { recovered, store: next } = recoverUnfinishedMessages(store, {
      inFlightIds: new Set([]),
    });
    expect(recovered).toEqual([]);
    expect(next[0].status).toBe("pending");
  });
});

describe("createDedupeGuard (reused from natural/dedupe)", () => {
  it("rejects duplicate operation ids", () => {
    const guard = createDedupeGuard();
    expect(guard.markHandled("op-1")).toBe(true);
    expect(guard.markHandled("op-1")).toBe(false); // duplicate
    expect(guard.alreadyHandled("op-1")).toBe(true);
    expect(guard.markHandled("op-2")).toBe(true); // distinct passes
  });

  it("reset clears tracked ids", () => {
    const guard = createDedupeGuard();
    guard.markHandled("op-1");
    guard.reset();
    expect(guard.markHandled("op-1")).toBe(true);
  });
});