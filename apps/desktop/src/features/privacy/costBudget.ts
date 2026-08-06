/**
 * Cloud cost estimation + local budget tracking.
 *
 * Estimates the cost of a provider turn from simple per-unit rates (pure
 * arithmetic, no network), and tracks a spend budget so a runaway cloud bill
 * can be blocked before it accrues.
 */

import type { ProviderName } from "./providerPrivacy";

export type Currency = "USD";

/** Estimated cost, in cents of the given currency. */
export interface CostEstimate {
  readonly cents: number;
  readonly currency: Currency;
}

export interface EstimateInput {
  readonly provider: ProviderName;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly audioSeconds: number;
  readonly imageCount: number;
}

/** Per-unit rates in USD cents. */
export const RATE_TOKENS_IN_CENTS = 0.00002; // per input token
export const RATE_TOKENS_OUT_CENTS = 0.00006; // per output token
export const RATE_AUDIO_SEC_CENTS = 0.05; // per second of audio
export const RATE_IMAGE_CENTS = 2; // per generated image

export function estimateCost(input: EstimateInput): CostEstimate {
  const cents =
    input.tokensIn * RATE_TOKENS_IN_CENTS +
    input.tokensOut * RATE_TOKENS_OUT_CENTS +
    input.audioSeconds * RATE_AUDIO_SEC_CENTS +
    input.imageCount * RATE_IMAGE_CENTS;
  return { cents, currency: "USD" };
}

export class BudgetTracker {
  private budgetCents: number;
  private spentCents: number;

  constructor(initialBudgetCents = 0) {
    this.budgetCents = initialBudgetCents;
    this.spentCents = 0;
  }

  setBudgetCents(cents: number): void {
    this.budgetCents = cents;
  }

  /** Spend `cents`, returning the remaining budget. */
  spend(cents: number): number {
    this.spentCents += cents;
    return this.remainingCents();
  }

  remainingCents(): number {
    return this.budgetCents - this.spentCents;
  }

  /** True when spending `cents` would take the remaining budget below zero. */
  wouldExceed(cents: number): boolean {
    return this.remainingCents() - cents < 0;
  }
}

export interface EnforcementResult {
  readonly allowed: boolean;
  readonly remainingCents: number;
}

/**
 * Enforce an estimate against the budget. When allowed, the estimate is spent
 * and `remainingCents` reflects the post-spend balance; otherwise nothing is
 * spent and the current remaining balance is reported.
 */
export function enforceBudget(
  tracker: BudgetTracker,
  estimate: CostEstimate,
): EnforcementResult {
  if (tracker.wouldExceed(estimate.cents)) {
    return { allowed: false, remainingCents: tracker.remainingCents() };
  }
  return { allowed: true, remainingCents: tracker.spend(estimate.cents) };
}