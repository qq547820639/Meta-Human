import { describe, expect, it } from "vitest";

import { createDedupeGuard } from "./dedupe";

describe("createDedupeGuard", () => {
  it("accepts a fresh id and rejects the identical second id", () => {
    const guard = createDedupeGuard();
    expect(guard.markHandled("gen-1")).toBe(true);
    // The same logical message submitted again is a duplicate -> rejected.
    expect(guard.markHandled("gen-1")).toBe(false);
    expect(guard.alreadyHandled("gen-1")).toBe(true);
  });

  it("lets distinct ids pass even when interleaved", () => {
    const guard = createDedupeGuard();
    expect(guard.markHandled("a")).toBe(true);
    expect(guard.markHandled("b")).toBe(true);
    expect(guard.markHandled("a")).toBe(false);
    expect(guard.markHandled("c")).toBe(true);
  });

  it("alreadyHandled reports before any mark", () => {
    const guard = createDedupeGuard();
    expect(guard.alreadyHandled("msg-42")).toBe(false);
    guard.markHandled("msg-42");
    expect(guard.alreadyHandled("msg-42")).toBe(true);
  });

  it("reset clears all tracked ids", () => {
    const guard = createDedupeGuard();
    guard.markHandled("gen-1");
    expect(guard.alreadyHandled("gen-1")).toBe(true);
    guard.reset();
    expect(guard.alreadyHandled("gen-1")).toBe(false);
    expect(guard.markHandled("gen-1")).toBe(true);
  });

  it("bounds memory by evicting the oldest ids", () => {
    const guard = createDedupeGuard({ maxSize: 3 });
    guard.markHandled("a");
    guard.markHandled("b");
    guard.markHandled("c");
    // Adding a 4th evicts the oldest ("a").
    guard.markHandled("d");
    expect(guard.alreadyHandled("a")).toBe(false);
    expect(guard.alreadyHandled("b")).toBe(true);
    expect(guard.alreadyHandled("d")).toBe(true);
  });
});