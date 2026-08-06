import { describe, expect, it } from "vitest";

import {
  createCircuitBreaker,
  fallbackSequence,
  nextBackoffMs,
} from "./resilience";

describe("nextBackoffMs", () => {
  it("grows exponentially with the attempt", () => {
    expect(nextBackoffMs({ attempt: 0, baseMs: 100 })).toBe(100);
    expect(nextBackoffMs({ attempt: 1, baseMs: 100 })).toBe(200);
    expect(nextBackoffMs({ attempt: 2, baseMs: 100 })).toBe(400);
    expect(nextBackoffMs({ attempt: 3, baseMs: 100 })).toBe(800);
  });

  it("caps the value", () => {
    expect(nextBackoffMs({ attempt: 10, baseMs: 100, capMs: 1000 })).toBe(1000);
    expect(nextBackoffMs({ attempt: 0, baseMs: 100, capMs: 1000 })).toBe(100);
  });

  it("adds jitter within the stated bounds", () => {
    for (let i = 0; i < 50; i += 1) {
      const value = nextBackoffMs({ attempt: 1, baseMs: 100, jitterMs: 20 });
      expect(value).toBeGreaterThanOrEqual(180);
      expect(value).toBeLessThanOrEqual(220);
    }
  });

  it("never goes negative with jitter", () => {
    const value = nextBackoffMs({ attempt: 0, baseMs: 10, jitterMs: 100 });
    expect(value).toBeGreaterThanOrEqual(0);
  });
});

describe("createCircuitBreaker", () => {
  it("opens after the failure threshold", () => {
    let clock = 0;
    const breaker = createCircuitBreaker({
      failureThreshold: 3,
      cooldownMs: 1000,
      now: () => clock,
    });

    expect(breaker.isOpen()).toBe(false);
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.isOpen()).toBe(false);
    breaker.recordFailure();
    expect(breaker.isOpen()).toBe(true);
  });

  it("honours the cooldown before reset is allowed", () => {
    let clock = 0;
    const breaker = createCircuitBreaker({
      failureThreshold: 1,
      cooldownMs: 1000,
      now: () => clock,
    });

    breaker.recordFailure();
    expect(breaker.isOpen()).toBe(true);
    expect(breaker.tryReset()).toBe(false); // still cooling down

    clock += 1000;
    expect(breaker.isOpen()).toBe(false); // cooldown elapsed -> allow a trial
    expect(breaker.tryReset()).toBe(true); // now it can close
  });

  it("closes on success and re-arms", () => {
    let clock = 0;
    const breaker = createCircuitBreaker({
      failureThreshold: 2,
      cooldownMs: 1000,
      now: () => clock,
    });

    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.isOpen()).toBe(true);

    breaker.recordSuccess();
    expect(breaker.isOpen()).toBe(false);
    // After a success the failure count resets, so it needs the threshold again.
    breaker.recordFailure();
    expect(breaker.isOpen()).toBe(false);
    breaker.recordFailure();
    expect(breaker.isOpen()).toBe(true);
  });
});

describe("fallbackSequence", () => {
  it("returns the first healthy provider in order", () => {
    const providers = ["a", "b", "c"];
    const healthy = (p: string) => p === "b";
    expect(fallbackSequence(providers, healthy)).toBe("b");
  });

  it("returns null when none are healthy", () => {
    expect(fallbackSequence(["a", "b"], () => false)).toBeNull();
  });

  it("returns null for an empty list", () => {
    expect(fallbackSequence([], () => true)).toBeNull();
  });
});