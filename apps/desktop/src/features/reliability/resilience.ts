/**
 * Resilience primitives: exponential backoff, a circuit breaker and provider
 * fallback selection.
 *
 * These are pure, time-injected helpers (no timers, no `Date`) so they can be
 * unit-tested deterministically. The caller supplies a `now()` clock for the
 * breaker's cooldown bookkeeping.
 */

export interface BackoffOptions {
  /** Zero-based attempt index (0 = first retry). */
  readonly attempt: number;
  /** Base delay in ms. */
  readonly baseMs: number;
  /** Multiplicative factor per attempt. Default 2. */
  readonly factor?: number;
  /** ±jitter in ms added to the capped value. Default 0 (deterministic). */
  readonly jitterMs?: number;
  /** Hard ceiling on the pre-jitter value, in ms. Default unbounded. */
  readonly capMs?: number;
}

/**
 * Compute the next backoff delay: `min(baseMs * factor^attempt, capMs)`, then
 * optionally add uniform jitter in `[-jitterMs, +jitterMs]`. The result is
 * rounded to a whole millisecond and never negative.
 */
export function nextBackoffMs({
  attempt,
  baseMs,
  factor = 2,
  jitterMs = 0,
  capMs,
}: BackoffOptions): number {
  const exponential = baseMs * Math.pow(factor, Math.max(0, attempt));
  const capped =
    capMs !== undefined && capMs > 0 ? Math.min(exponential, capMs) : exponential;
  const jitter = jitterMs > 0 ? (Math.random() * 2 - 1) * jitterMs : 0;
  return Math.max(0, Math.round(capped + jitter));
}

export interface CircuitBreaker {
  /** Record a successful call. Closes the breaker if it was open. */
  recordSuccess(): void;
  /** Record a failed call. Opens the breaker once the threshold is reached. */
  recordFailure(): void;
  /** True while the breaker rejects traffic (open and within cooldown). */
  isOpen(): boolean;
  /**
   * Try to close a cooled-down open breaker. Returns true (and closes) once
   * the cooldown has elapsed; returns false otherwise.
   */
  tryReset(): boolean;
}

export interface CircuitBreakerOptions {
  /** Consecutive failures that trip the breaker open. */
  readonly failureThreshold: number;
  /** Cooldown window (ms) before the breaker may be re-armed. */
  readonly cooldownMs: number;
  /** Injectable clock; returns the current time in ms. */
  readonly now: () => number;
}

/**
 * A half-open-capable circuit breaker backed by a closure and an injected
 * clock. A call that occurs while the breaker is open and still cooling down
 * is rejected (`isOpen() === true`). Once the cooldown elapses `isOpen()`
 * returns false (a single trial is allowed) and `tryReset()` closes it.
 */
export function createCircuitBreaker({
  failureThreshold,
  cooldownMs,
  now,
}: CircuitBreakerOptions): CircuitBreaker {
  let failures = 0;
  let open = false;
  let openedAt = 0;

  return {
    recordSuccess() {
      failures = 0;
      if (open) {
        open = false;
        openedAt = 0;
      }
    },
    recordFailure() {
      failures += 1;
      if (!open && failures >= failureThreshold) {
        open = true;
        openedAt = now();
      }
    },
    isOpen() {
      return open && now() - openedAt < cooldownMs;
    },
    tryReset() {
      if (!open) {
        return false;
      }
      if (now() - openedAt < cooldownMs) {
        return false;
      }
      open = false;
      openedAt = 0;
      failures = 0;
      return true;
    },
  };
}

/**
 * Return the first provider in `providers` for which `isHealthy` is true, or
 * `null` when none are healthy. Used to pick a fallback provider in order.
 */
export function fallbackSequence<T>(
  providers: readonly T[],
  isHealthy: (provider: T) => boolean,
): T | null {
  for (const provider of providers) {
    if (isHealthy(provider)) {
      return provider;
    }
  }
  return null;
}