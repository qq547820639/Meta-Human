import { describe, expect, it, vi } from "vitest";

import {
  createRemoteResourceManager,
  type RemoteResourceState,
} from "./remoteResource";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("createRemoteResourceManager", () => {
  it("dedupes concurrent creates for the same key into one call", async () => {
    const createFn = vi.fn((key: string) => Promise.resolve({ id: key }));
    const manager = createRemoteResourceManager({ createFn, deleteFn: vi.fn() });

    const [a, b] = await Promise.all([
      manager.get("sess-1"),
      manager.get("sess-1"),
    ]);
    expect(createFn).toHaveBeenCalledTimes(1);
    expect(a).toEqual({ id: "sess-1" });
    expect(b).toEqual({ id: "sess-1" });
  });

  it("is idempotent: re-requesting the same key returns the existing session", async () => {
    const createFn = vi.fn((key: string) => Promise.resolve({ id: key }));
    const manager = createRemoteResourceManager({ createFn, deleteFn: vi.fn() });

    const first = await manager.get("sess-1");
    const second = await manager.get("sess-1");
    expect(second).toBe(first);
    expect(createFn).toHaveBeenCalledTimes(1);
  });

  it("retries with backoff when the create fails, then succeeds", async () => {
    const createFn = vi
      .fn<() => Promise<{ id: string }>>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ id: "sess-1" });
    const manager = createRemoteResourceManager({
      createFn,
      deleteFn: vi.fn(),
      maxRetries: 2,
      baseDelayMs: 1,
    });

    await expect(manager.get("sess-1")).resolves.toEqual({ id: "sess-1" });
    expect(createFn).toHaveBeenCalledTimes(2);
  });

  it("surfaces an error after exhausting retries", async () => {
    const createFn = vi.fn().mockRejectedValue(new Error("boom"));
    const manager = createRemoteResourceManager({
      createFn,
      deleteFn: vi.fn(),
      maxRetries: 1,
      baseDelayMs: 1,
    });

    await expect(manager.get("sess-1")).rejects.toThrow("boom");
  });

  it("delete() triggers remote cleanup and drops the cached session", async () => {
    const deleteFn = vi.fn();
    const manager = createRemoteResourceManager({
      createFn: (key) => Promise.resolve({ id: key }),
      deleteFn,
    });

    const session = await manager.get("sess-1");
    await manager.delete("sess-1");
    expect(deleteFn).toHaveBeenCalledWith("sess-1", session);

    // A later get creates a fresh session (cache was cleared).
    const next = await manager.get("sess-1");
    expect(next).not.toBe(session);
  });

  it("delete() waits for an in-flight create and cleans up the created resource", async () => {
    const deleteFn = vi.fn();
    const d = deferred<{ id: string }>();
    const createFn = vi.fn(() => d.promise);
    const manager = createRemoteResourceManager({ createFn, deleteFn });

    const pending = manager.get("sess-1");
    const deleting = manager.delete("sess-1");
    d.resolve({ id: "sess-1" });
    await Promise.all([pending, deleting]);
    expect(createFn).toHaveBeenCalledTimes(1);
    expect(deleteFn).toHaveBeenCalledWith("sess-1", { id: "sess-1" });
  });

  it("delete() on a never-created key is a no-op", async () => {
    const deleteFn = vi.fn();
    const manager = createRemoteResourceManager({
      createFn: vi.fn(),
      deleteFn,
    });
    await manager.delete("nope");
    expect(deleteFn).not.toHaveBeenCalled();
  });

  it("emits state transitions to the observer", async () => {
    const states: RemoteResourceState<{ id: string }>[] = [];
    const manager = createRemoteResourceManager({
      createFn: (key) => Promise.resolve({ id: key }),
      deleteFn: vi.fn(),
      onState: (s) => states.push(s),
    });
    await manager.get("sess-1");
    expect(states.map((s) => s.status)).toEqual(["creating", "ready"]);
  });
});