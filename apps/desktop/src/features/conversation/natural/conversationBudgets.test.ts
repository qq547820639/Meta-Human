import { describe, expect, it } from "vitest";

import {
  budgetForMetric,
  buildBudgetReportMarkdown,
  checkConversationBudget,
  conversationBudgets,
  summarizeBudgetResult,
  violationsForPercentiles,
} from "./conversationBudgets";
import {
  baselineConversationBudgetSamples,
  degradedConversationBudgetSamples,
} from "./conversationBudgets.fixture";

describe("conversationBudgets", () => {
  it("defines a budget for every natural-conversation stage metric", () => {
    const metrics = [
      "speechToFirstTranscriptMs",
      "speechEndToTranscriptMs",
      "submitToFirstTokenMs",
      "firstTokenToFirstAudioMs",
      "avSyncErrorMs",
      "interruptToSilenceMs",
    ] as const;
    for (const metric of metrics) {
      expect(budgetForMetric(metric)).toBeDefined();
    }
    expect(conversationBudgets.length).toBeGreaterThanOrEqual(6);
  });

  it("reports no violations when every measured stage is within budget", () => {
    const measured = {
      speechToFirstTranscriptMs: 300,
      speechEndToTranscriptMs: 500,
      submitToFirstTokenMs: 1000,
      firstTokenToFirstAudioMs: 1500,
      avSyncErrorMs: 100,
      interruptToSilenceMs: 120,
    };
    expect(checkConversationBudget(measured)).toEqual([]);
  });

  it("flags a stage that exceeds its budget and records the overshoot", () => {
    const budget = budgetForMetric("firstTokenToFirstAudioMs");
    const violations = checkConversationBudget({ firstTokenToFirstAudioMs: 2600 });
    expect(violations).toHaveLength(1);
    expect(violations[0].metric).toBe("firstTokenToFirstAudioMs");
    expect(violations[0].overMs).toBe(2600 - (budget?.budgetMs ?? 0));
  });

  it("ignores unmeasured stages (no fabricated pass/fail)", () => {
    expect(checkConversationBudget({})).toEqual([]);
    expect(checkConversationBudget({ avSyncErrorMs: 999999 })).toHaveLength(1);
  });

  it("summarizeBudgetResult renders each metric with a status column", () => {
    const md = summarizeBudgetResult({ avSyncErrorMs: 100 });
    expect(md).toContain("音画同步偏差");
    expect(md).toContain("✅ 达标");
  });

  it("marks an over-budget metric as violated in the summary", () => {
    const md = summarizeBudgetResult({ avSyncErrorMs: 500 });
    expect(md).toContain("❌ 超限");
  });

  it("violationsForPercentiles checks the P95 of sample sets against budgets", () => {
    // P95 of [700..1490] = 1490 which is within the 1500ms submit budget.
    const within = violationsForPercentiles({
      submitToFirstTokenMs: [700, 800, 900, 1000, 1100, 1200, 1300, 1400, 1450, 1490],
    });
    expect(within).toEqual([]);

    // P95 of [100..1000] = 1000 which blows the 300ms avSync budget.
    const over = violationsForPercentiles({
      avSyncErrorMs: [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000],
    });
    expect(over.length).toBeGreaterThan(0);
    expect(over[0].metric).toBe("avSyncErrorMs");
  });

  it("baseline fixture is fully within budget (CI must stay green)", () => {
    const violations = violationsForPercentiles(baselineConversationBudgetSamples.samples);
    expect(violations).toEqual([]);
  });

  it("degraded fixture trips the CI gate (TTS + avSync over budget)", () => {
    const violations = violationsForPercentiles(degradedConversationBudgetSamples.samples);
    expect(violations.length).toBeGreaterThan(0);
    const metrics = violations.map((v) => v.metric);
    expect(metrics).toContain("firstTokenToFirstAudioMs");
    expect(metrics).toContain("avSyncErrorMs");
  });

  it("buildBudgetReportMarkdown renders a report with a conclusion", () => {
    const md = buildBudgetReportMarkdown(baselineConversationBudgetSamples);
    expect(md).toContain("# 对话性能预算报告");
    expect(md).toContain("**结论：全部达标签 ✅**");
    for (const budget of conversationBudgets) {
      expect(md).toContain(budget.label);
    }
  });
});