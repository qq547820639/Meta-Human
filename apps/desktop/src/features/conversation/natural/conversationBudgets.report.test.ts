import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildBudgetReportMarkdown,
  checkConversationBudget,
  conversationBudgets,
  violationsForPercentiles,
} from "./conversationBudgets";
import { baselineConversationBudgetSamples } from "./conversationBudgets.fixture";

/**
 * CI gate + report generator for the conversation latency budgets.
 *
 * When `CONVERSATION_BUDGET_OUTPUT_DIR` is set (by
 * scripts/generate-conversation-budget-report.sh) this test writes the
 * human-readable Markdown and machine-readable JSON report into that directory,
 * then enforces the budgets: any stage whose P95 exceeds its budget fails the
 * test (and therefore CI). Under a plain `npm test` with no env var it only
 * enforces the budgets and writes nothing.
 */
describe("conversation budget report + CI gate", () => {
  it(`baseline (${baselineConversationBudgetSamples.label}) stays within budget and writes a report`, () => {
    const violations = violationsForPercentiles(baselineConversationBudgetSamples.samples);
    const md = buildBudgetReportMarkdown(baselineConversationBudgetSamples);

    const outDir = process.env.CONVERSATION_BUDGET_OUTPUT_DIR;
    if (outDir) {
      mkdirSync(outDir, { recursive: true });
      writeFileSync(join(outDir, "conversation-budget-report.md"), md);
      writeFileSync(
        join(outDir, "conversation-budget-report.json"),
        `${JSON.stringify(budgetReportJson(baselineConversationBudgetSamples.label), null, 2)}\n`,
      );
    }

    expect(violations).toEqual([]);
    expect(md).toContain("**结论：全部达标签 ✅**");
  });
});

function budgetReportJson(label: string): Record<string, unknown> {
  const measured: Record<string, number> = {};
  for (const budget of conversationBudgets) {
    const arr = baselineConversationBudgetSamples.samples[budget.metric];
    if (!arr || arr.length === 0) {
      continue;
    }
    const sorted = [...arr].sort((a, b) => a - b);
    const p95Index = Math.min(
      sorted.length - 1,
      Math.max(0, Math.ceil(0.95 * sorted.length) - 1),
    );
    measured[budget.metric] = sorted[p95Index];
  }
  const violations = checkConversationBudget(measured);
  return {
    label,
    generatedAt: new Date().toISOString(),
    budgets: conversationBudgets.map((b) => ({
      metric: b.metric,
      label: b.label,
      budgetMs: b.budgetMs,
    })),
    measuredP95Ms: measured,
    violations: violations.map((v) => ({
      metric: v.metric,
      label: v.label,
      budgetMs: v.budgetMs,
      measuredMs: v.measuredMs,
      overMs: v.overMs,
    })),
    pass: violations.length === 0,
  };
}